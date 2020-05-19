import admin from 'firebase-admin';
import { googleCloudProjectId } from './configProvider';
import serviceAccount from './firebase-admin-key.json';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${googleCloudProjectId}.firebaseio.com`,
});

const db = admin.firestore();
const settings = { timestampsInSnapshots: true };
db.settings(settings);


export const userExists = async (userId) => {
  const userDoc = await db.collection('users').doc(userId).get();
  return userDoc.exists;
};

export const getUserId = async (accessToken) => {
  const querySnapshot = await db
    .collection('users')
    .where('fakeAccessToken', '==', accessToken)
    .get();
  if (querySnapshot.empty) {
    throw new Error('No user found for this access token');
  }
  const doc = querySnapshot.docs[0];
  return doc.id; // This is the user id in Firestore
};

export const homegraphEnabled = async (userId) => {
  const userDoc = await db.collection('users').doc(userId).get();
  const { homegraph } = userDoc.data() || {};
  return !!homegraph;
};

export const setHomegraphEnable = async (userId, enable) => {
  await db.collection('users').doc(userId).update({
    homegraph: enable,
  });
};

export const updateDevice = async (
  userId,
  deviceId,
  name,
  nickname,
  states,
  localDeviceId,
  errorCode,
  tfa,
  foodPresets,
) => {
  // Payload can contain any state data
  const updatePayload = {};
  if (name) {
    updatePayload['name'] = name;
  }
  if (nickname) {
    updatePayload['nicknames'] = [nickname];
  }
  if (states) {
    updatePayload['states'] = states;
  }
  if (localDeviceId === null) { // null means local execution has been disabled.
    updatePayload['otherDeviceIds'] = admin.firestore.FieldValue.delete();
  } else if (localDeviceId !== undefined) { // undefined means localDeviceId was not updated.
    updatePayload['otherDeviceIds'] = [{ deviceId: localDeviceId }];
  }
  if (errorCode) {
    updatePayload['errorCode'] = errorCode;
  } else if (!errorCode) {
    updatePayload['errorCode'] = '';
  }
  if (tfa) {
    updatePayload['tfa'] = tfa;
  } else if (tfa !== undefined) {
    updatePayload['tfa'] = '';
  }
  if (foodPresets) {
    updatePayload['attributes'] = {};
    updatePayload['attributes']['foodPresets'] = foodPresets;
    updatePayload['attributes']['supportedCookingModes'] = 'BREW';
  }

  await db.collection('users')
    .doc(userId)
    .collection('devices')
    .doc(deviceId)
    .update(updatePayload);
};

export const getDevices = async (userId) => {
  const devices = []
  const querySnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('devices')
    .get();

  querySnapshot.forEach(doc => {
    const data = doc.data();
    const device = {
      id: data.id,
      type: data.type,
      traits: data.traits,
      name: {
        defaultNames: data.defaultNames,
        name: data.name,
        nicknames: data.nicknames,
      },
      deviceInfo: {
        manufacturer: data.manufacturer,
        model: data.model,
        hwVersion: data.hwVersion,
        swVersion: data.swVersion,
      },
      willReportState: data.willReportState,
      attributes: data.attributes,
      otherDeviceIds: data.otherDeviceIds,
      customData: data.customData,
    };
    devices.push(device);
  });

  return devices;
};

export const getState = async (userId, deviceId) => {
  const doc = await db
    .collection('users')
    .doc(userId)
    .collection('devices')
    .doc(deviceId)
    .get();

  if (!doc.exists) {
    throw new Error('deviceNotFound');
  }

  const { states } = doc.data() || {};
  return !!states;
};

export const execute = async (userId, deviceId, execution) => {
  const doc = await db
    .collection('users')
    .doc(userId)
    .collection('devices')
    .doc(deviceId)
    .get();

  if (!doc.exists) {
    throw new Error('deviceNotFound');
  }

  const states = {
    online: true,
  };
  const data = doc.data();
  const { states: statesData, errorCode, tfa } = data || {};
  if (!data && !!statesData.online) {
    throw new Error('deviceOffline');
  }
  if (!!errorCode) {
    throw new Error(errorCode);
  }
  if ((tfa && tfa === 'ack') && !execution.challenge) {
    throw new Error('ackNeeded');
  } else if (!!tfa && !execution.challenge) {
    throw new Error('pinNeeded');
  } else if (!!tfa && execution.challenge) {
    if (execution.challenge.pin && (!!tfa && execution.challenge.pin !== tfa)) {
      throw new Error('challengeFailedPinNeeded');
    }
  }

  switch (execution.command) {
    // action.devices.traits.Cook
    case 'action.devices.commands.Cook': {
      if (execution.params && execution.params.start) {
        const { foodPreset } = execution.params;
        // Start cooking
        await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
          'states.currentCookingMode': 'BREW',
          'states.currentFoodPreset': foodPreset || 'NONE',
          'states.currentFoodQuantity': 1,
        });
        states['currentCookingMode'] = 'BREW'
        states['currentFoodPreset'] = foodPreset;
        states['currentFoodQuantity'] = 1;
      } else {
        // Done cooking, reset
        await db.collection('users').doc(userId).collection('devices').doc(deviceId).update({
          'states.currentCookingMode': 'NONE',
          'states.currentFoodPreset': 'NONE',
          'states.currentFoodQuantity': 1,
        });
        states['currentCookingMode'] = 'NONE';
        states['currentFoodPreset'] = 'NONE';
      }
      break;
    }

    default:
      throw new Error('actionNotAvailable');
  }

  return states;
}

export const disconnect = async (userId) => {
  await setHomegraphEnable(userId, false);
};
