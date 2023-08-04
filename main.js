import { moduleName } from './const/config.const.js';
import { EnsModule } from './modules/ens/ens.module.js';
import { importETHWallets } from './helpers/accs.helper.js';
import { randomIntInRange } from './helpers/general.helper.js';
import { waitForGas } from './helpers/gas.helper.js';

const ethWallets = await importETHWallets();

if (!ethWallets) {
  console.log(`${moduleName}. No wallets found.`);
  process.exit(0);
}

// main loop
for (let i = 0; i < ethWallets.length; i++) {
  const privateKey = ethWallets[i];
  const ensInstance = new EnsModule(privateKey);

  // check gas
  await waitForGas(ensInstance.web3, ensInstance.walletAddress);

  const result = await ensInstance.register();

  if (result && result.needed === false) {
    // skip sleep, if nft is already on the account
    continue;
  }

  if (i < ethWallets.length - 1) {
    const timing = randomIntInRange(sleepFrom, sleepTo);
    console.log(`${moduleName}. Waiting for ${timing} seconds before next mint...`);
    await sleep(timing * 1000);
  }
}
