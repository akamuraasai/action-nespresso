import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import morgan from 'morgan';
import ngrok from 'ngrok';
import { smarthome } from 'actions-on-google';
import * as Firestore from './firestore';
import * as Auth from './authProvider';
import * as Config from './configProvider';
import { createInstance } from './makeCoffee';
import jwt from './smart-home-key.json';

const expressApp = express();
expressApp.use(cors());
expressApp.use(morgan('dev'));
expressApp.use(bodyParser.json());
expressApp.use(bodyParser.urlencoded({ extended: true }));
expressApp.set('trust proxy', 1);

Auth.registerAuthEndpoints(expressApp);

const appPort = process.env.PORT || Config.expressPort;

const app = smarthome({ jwt, debug: true });

const nespressoMachine = createInstance();

const executeCommandOnMachine = async (state) => {
  const waitFinish = new Promise((resolve) => {
    nespressoMachine.init(resolve, state);
  });
  await waitFinish;
};

const asyncForEach = async (array, callback) => {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
};

const getUserIdOrThrow = async (headers) => {
  const userId = await Auth.getUser(headers);
  const userExists = await Firestore.userExists(userId);
  if (!userExists) {
    throw new Error(`User ${userId} has not created an account, so there are no devices`);
  }
  return userId;
};

const reportState = async (agentUserId, deviceId, states) => (
  app.reportState({
    agentUserId,
    requestId: Math.random().toString(),
    payload: {
      devices: {
        states: {
          [deviceId]: states,
        },
      },
    },
  })
);

app.onSync(async (body, headers) => {
  const userId = await getUserIdOrThrow(headers);
  await Firestore.setHomegraphEnable(userId, true);

  const devices = await Firestore.getDevices(userId);
  return {
    requestId: body.requestId,
    payload: {
      agentUserId: userId,
      devices,
    },
  };
});

app.onQuery(async (body, headers) => {
  const userId = await getUserIdOrThrow(headers);
  const deviceStates = {};
  const { devices } = body.inputs[0].payload;
  await asyncForEach(devices, async (device) => {
    try {
      const states = await Firestore.getState(userId, device.id);
      deviceStates[device.id] = {
        ...states,
        status: 'SUCCESS',
      };
      await reportState(userId, device.id, states);
    } catch (e) {
      console.error(e);
      deviceStates[device.id] = {
        status: 'ERROR',
        errorCode: 'deviceOffline',
      };
    }
  });

  return {
    requestId: body.requestId,
    payload: {
      devices: deviceStates,
    },
  };
});

app.onExecute(async (body, headers) => {
  const userId = await getUserIdOrThrow(headers);
  const commands = []
  const successCommand = {
    ids: [],
    status: 'SUCCESS',
    states: {},
  };

  const { devices, execution } = body.inputs[0].payload.commands[0];
  await asyncForEach(devices, async (device) => {
    try {
      const states = await Firestore.execute(userId, device.id, execution[0]);
      await executeCommandOnMachine(states);
      successCommand.ids.push(device.id);
      successCommand.states = states;
      await reportState(userId, device.id, states);
    } catch (e) {
      console.error(e);
      if (e.message === 'pinNeeded') {
        commands.push({
          ids: [device.id],
          status: 'ERROR',
          errorCode: 'challengeNeeded',
          challengeNeeded: {
            type: 'pinNeeded',
          },
        });
        return;
      } else if (e.message === 'challengeFailedPinNeeded') {
        commands.push({
          ids: [device.id],
          status: 'ERROR',
          errorCode: 'challengeNeeded',
          challengeNeeded: {
            type: 'challengeFailedPinNeeded',
          },
        });
        return;
      } else if (e.message === 'ackNeeded') {
        commands.push({
          ids: [device.id],
          status: 'ERROR',
          errorCode: 'challengeNeeded',
          challengeNeeded: {
            type: 'ackNeeded',
          },
        });
        return;
      } else if (e.message === 'PENDING') {
        commands.push({
          ids: [device.id],
          status: 'PENDING',
        });
        return;
      }
      commands.push({
        ids: [device.id],
        status: 'ERROR',
        errorCode: e.message,
      });
    }
  });

  if (successCommand.ids.length) {
    commands.push(successCommand);
  }

  return {
    requestId: body.requestId,
    payload: {
      commands,
    },
  };
});

app.onDisconnect(async (body, headers) => {
  const userId = await getUserIdOrThrow(headers);
  await Firestore.disconnect(userId);
});

expressApp.post('/smarthome', app);

expressApp.post('/smarthome/update', async (req, res) => {
  const { userId, deviceId, name, nickname, states, localDeviceId, errorCode, tfa, foodPresets } = req.body;
  try {
    await Firestore.updateDevice(userId, deviceId, name, nickname, states, localDeviceId, errorCode, tfa, foodPresets);
    if (localDeviceId || localDeviceId === null) {
      await app.requestSync(userId);
    }
    if (states !== undefined) {
      const res = await reportState(userId, deviceId, states);
    }
    res.status(200).send('OK');
  } catch(e) {
    console.error(e)
    res.status(400).send(`Error updating device: ${e}`);
  }
});

const expressServer = expressApp.listen(appPort, async () => {
  const server = expressServer.address();
  const { address, port } = server;

  console.log(`Smart home server listening at ${address}:${port}`);

  if (Config.useNgrok) {
    try {
      const ngrokOptions = {
        proto: 'http',
        addr: Config.expressPort,
        subdomain: Config.ngrokSubDomain,
      }
      // const url = await ngrok.connect(Config.expressPort);
      const url = await ngrok.connect(ngrokOptions);
      console.log('');
      console.log('COPY & PASTE NGROK URL BELOW');
      console.log(url);
      console.log('');
      console.log('=====');
      console.log('Visit the Actions on Google console at http://console.actions.google.com');
      console.log('Replace the webhook URL in the Actions section with:');
      console.log('    ' + url + '/smarthome');

      console.log('');
      console.log('In the console, set the Authorization URL to:');
      console.log('    ' + url + '/fakeauth');

      console.log('');
      console.log('Then set the Token URL to:');
      console.log('    ' + url + '/faketoken');
      console.log('');

      console.log('Finally press the \'TEST DRAFT\' button');
    } catch (err) {
      console.error('Ngrok was unable to start');
      console.error(err);
      process.exit();
    }
  }
});
