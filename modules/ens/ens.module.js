import HttpProvider from 'ethjs-provider-http';
import Web3 from 'web3';
import Ens from 'ethjs-ens';
import namehash from '@ensdomains/eth-ens-namehash';
import { formatsByCoinType } from '@ensdomains/address-encoder';

import { ETH, domainDuration, sleepBeforeRegistering } from '../../const/config.const.js';
import { getDaysInSeconds } from '../../helpers/duration.helper.js';
import { getAbiByRelativePath, sleep } from '../../helpers/general.helper.js';
import { extractNumbersFromString } from '../../helpers/string.helper.js';
import { generateName, generateSalt } from '../../helpers/generator.helper.js';

export class EnsModule {
  constructor(privateKey) {
    this.protocolName = 'ENS';
    this.chain = ETH;
    this.web3 = new Web3(this.chain.rpc);

    this.privateKey = privateKey;
    this.account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
    this.walletAddress = this.account.address;

    this.contractAddr = this.web3.utils.toChecksumAddress('0x253553366da8546fc250f225fe3d25d0c782303b');
    this.contractAbi = getAbiByRelativePath('./abi/controllerAbi.json');

    this.publicResolverAddr = this.web3.utils.toChecksumAddress('0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63');
    this.publicResolverAbi = getAbiByRelativePath('./abi/resolverAbi.json');

    this.contract = new this.web3.eth.Contract(this.contractAbi, this.contractAddr);
    this.resolverContract = new this.web3.eth.Contract(this.publicResolverAbi, this.publicResolverAddr);

    this.providerForENS = new HttpProvider(this.chain.rpc);
    this.ens = new Ens({ provider: this.providerForENS, network: '1' });

    this.duration = getDaysInSeconds(domainDuration);
  }

  async register() {
    if (await this.isAlreadyRegistered()) {
      return false;
    }

    let name;

    while (true) {
      name = generateName();
      const taken = await this.isTaken(name);
      if (!taken) {
        break;
      }
    }

    // Generate a random value to mask our commitment
    const salt = generateSalt();
    const resolverCalldata = this.getCalldata(name);

    try {
      // Add 10% to account for price fluctuation; the difference is refunded.
      const price = parseInt(
        (await this.contract.methods.rentPrice(name, this.duration).call({ from: this.walletAddress }))[0]
      );

      const commitment = await this.contract.methods
        .makeCommitment(
          name,
          this.walletAddress,
          this.duration,
          salt,
          this.publicResolverAddr,
          resolverCalldata,
          true,
          0
        )
        .call();

      const commitFunctionCall = await this.contract.methods.commit(commitment);

      const commitEstimatedGas = await commitFunctionCall.estimateGas({
        from: this.walletAddress,
        value: 0,
      });

      const commitTx = {
        from: this.walletAddress,
        to: this.contractAddr,
        value: 0,
        nonce: await this.web3.eth.getTransactionCount(this.walletAddress),
        gas: commitEstimatedGas,
        data: commitFunctionCall.encodeABI(),
      };

      const commitSignedTx = await this.web3.eth.accounts.signTransaction(commitTx, this.privateKey);
      const commitSendTransactionResult = await this.web3.eth.sendSignedTransaction(commitSignedTx.rawTransaction);

      console.log(
        `${this.protocolName}. ${this.walletAddress}: Commit transaction sent | TX: ${this.chain.explorer}/${commitSendTransactionResult.transactionHash}`
      );

      // Wait 60 seconds before registering
      await sleep(sleepBeforeRegistering * 1000);

      // Submit our registration request
      const registerFunctionCall = await this.contract.methods.register(
        name,
        this.walletAddress,
        this.duration,
        salt,
        this.publicResolverAddr,
        resolverCalldata,
        true,
        0
      );

      const registerEstimatedGas = await registerFunctionCall.estimateGas({
        from: this.walletAddress,
        value: price,
      });

      const registerTx = {
        from: this.walletAddress,
        to: this.contractAddr,
        value: price.toString(),
        nonce: await this.web3.eth.getTransactionCount(this.walletAddress),
        gas: registerEstimatedGas,
        data: registerFunctionCall.encodeABI(),
      };

      const registerSignedTx = await this.web3.eth.accounts.signTransaction(registerTx, this.privateKey);
      const registerSendTransactionResult = await this.web3.eth.sendSignedTransaction(registerSignedTx.rawTransaction);

      console.log(
        `${this.protocolName}. ${this.walletAddress}: Registered ${name}.eth | TX: ${this.chain.explorer}/${registerSendTransactionResult.transactionHash}`
      );
    } catch (e) {
      if (e.message.includes('insufficient funds')) {
        const [balance, fee, value] = extractNumbersFromString(e.message);
        const feeInEther = this.web3.utils.fromWei(fee, 'ether');
        const balanceInEther = this.web3.utils.fromWei(balance, 'ether');
        const valueInEther = this.web3.utils.fromWei(value, 'ether');

        console.error(
          `${this.protocolName}. ${this.walletAddress} | Insufficient funds for transaction. Fee - ${feeInEther}, Value - ${valueInEther}, Balance - ${balanceInEther}`
        );
      } else {
        console.error(e);
      }
    }
  }

  async isTaken(name) {
    try {
      const address = await this.ens.lookup(name);
      return !!address;
    } catch (e) {
      return false;
    }
  }

  async isAlreadyRegistered() {
    try {
      const name = await this.ens.reverse(this.walletAddress);

      if (this.walletAddress != (await this.ens.lookup(name))) {
        name = null;
      }

      return !!name;
    } catch (e) {
      return false;
    }
  }

  getCalldata(name) {
    // Each element in the array is a function call to the resolver
    // Most basic UI flow sets setBlockchainAddress function call in the calldata

    const nameHash = namehash.hash(name + '.eth');
    const coinType = 60;
    const addrCalldata = formatsByCoinType[coinType].decoder(this.walletAddress);

    const encodedAbi = this.resolverContract.methods.setAddr(nameHash, coinType, addrCalldata).encodeABI();
    return [encodedAbi];
  }
}
