const noble = require('@abandonware/noble');

const MACHINE_KEY = process.env.NESPRESSO_MACHINE_KEY || '8f9fdd9fac836416';

const temperatures = {
  morno: '01',
  quente: '00',
  'muito quente': '02',
  default: '00',
};

const volumes = {
  ristretto: '00',
  espresso: '01',
  lungo: '02',
  'agua quente': '04',
  americano: '05',
  receita: '07',
  default: '00',
};

const getCommand = (volume, temperature) => Buffer.from(
  `0305070400000000${temperatures[temperature] || temperatures.default}${volumes[volume] || volumes.default}`,
  'hex',
);
const getKey = () => Buffer.from(MACHINE_KEY, 'hex');

const init = (getState) => async (finishedCb, { currentFoodPreset }) => {
  const { peripheral, ready } = getState();
  if (!ready) {
    finishedCb();
  }

  peripheral.on('disconnect', () => {
    console.log('Cafeteira desconectada.');
    finishedCb();
    // process.exit(0);
  });

  await peripheral.connectAsync();
  console.log('Cafeteira conectada.\n');

  console.log('Adquirindo serviços...');
  const { characteristics: [carat] } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(['06aa1910-f22a-11e3-9daa-0002a5d5c51b'], ['06aa3a41-f22a-11e3-9daa-0002a5d5c51b']);
  const { characteristics: [_, command] } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(['06aa1920-f22a-11e3-9daa-0002a5d5c51b'], ['06aa3a42-f22a-11e3-9daa-0002a5d5c51b']);
  console.log('Serviços adquiridos com sucesso.\n');

  console.log('Enviando comando de login...');
  carat.write(getKey(), false);
  console.log('Logado com sucesso.\n');

  setTimeout(() => {
    console.log('Enviando requisição de café...');
    command.write(getCommand(currentFoodPreset, 'muito quente'), false);
    console.log('Café sendo preparado.\n');

    setTimeout(async () => {
      await peripheral.disconnectAsync();
    }, 1000);
  }, 1000);
};

const stateChange = async (status) => {
  if (status === 'poweredOn') {
    console.log('Bluetooth iniciado.');
    await noble.startScanningAsync();
  }
};

const discover = (setState) => async (peripheral) => {
  if (peripheral.address === 'e9-c6-dd-63-48-d2') {
    await noble.stopScanningAsync();
    console.log('Cafeteira encontrada.\n');
    setState({ peripheral, ready: true });
  }
};

export const createInstance = () => {
  let state = {
    peripheral: null,
    ready: false,
  };

  const getState = () => state;
  const setState = (value) => {
    state = {
      ...state,
      ...value,
    };
  };

  noble.on('stateChange', stateChange);
  noble.on('discover', discover(setState));
  return {
    getState,
    init: init(getState),
  };
};

if (process.env.DEBUG_NESPRESSO_MACHINE) {
  const nespressoMachine = createInstance();
  const executeCommandOnMachine = async (state) => {
    const waitFinish = new Promise((resolve) => {
      nespressoMachine.init(resolve, state);
    });
    await waitFinish;
  };

  setTimeout(async () => {
    await executeCommandOnMachine();
  }, 20000);
}
