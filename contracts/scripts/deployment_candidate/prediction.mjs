// Pinned factory source: CloneProxyBytecode.creationCode + VerifiableFactory salt mixing.
import { AbiCoder, getCreate2Address, keccak256 } from 'ethers';
export function factoryPrediction(factory,logic,owner,salt){
  const outerSalt=keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[owner,salt]));
  const runtime='0x363d3d373d3d3d363d73'+logic.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3'+outerSalt.slice(2);
  const creation='0x3d604d80600a3d3981f3'+runtime.slice(2);
  return {address:getCreate2Address(factory,outerSalt,keccak256(creation)),outerSalt,runtime,creationHash:keccak256(creation)};
}
