// All addresses, receipts and provider responses in this module are TEST ONLY.
import { Interface, keccak256 } from 'ethers';
import { DeploymentWorkflow, digest } from '../workflow.mjs';
export const OWNER = '0x00000000000000000000000000000000000A11cE';
export const TOKEN = '0x0000000000000000000000000000000000001234';
export const HASH = '0x' + '22'.repeat(32);
export const BLOCK = '0x' + '11'.repeat(32);
export const ABI = ['function mint(address,uint256)', 'event Transfer(address indexed from,address indexed to,uint256 value)'];
export const ZERO = '0x' + '00'.repeat(20);
const WORD = '0x' + '0'.repeat(63) + '1';
export function packet(id = 'T01', nonce = 0) {
  return { id, inputClass: 'TEST_ONLY', signature: 'mint(address,uint256)', abi: ABI, arguments: [OWNER, '8000021'], expectedTarget: TOKEN,
    creation: false, tx: { from: OWNER, to: TOKEN, data: new Interface(ABI).encodeFunctionData('mint', [OWNER, 8000021]), chainId: '0xaa36a7', value: '0x0', nonce: '0x' + nonce.toString(16), gas: '0x186a0', maxFeePerGas: '0x64', maxPriorityFeePerGas: '0x1' },
    tokenReview: { token: TOKEN, units: '8000021', decimals: 6, amount: '8.000021', allowanceUnits: '0', spender: 'not applicable', classification: 'TEST_ONLY' },
    prerequisites: [{ id: 'TEST_RUNTIME', kind: 'code', to: TOKEN, expectedHash: keccak256('0x6000') }, { id: 'TEST_STATE', kind: 'call', to: TOKEN, data: '0x12345678', expected: WORD }],
    postconditions: [{ id: 'TEST_POST_STATE', kind: 'call', to: TOKEN, data: '0x12345678', expected: WORD }],
    expectedEvents: [{ address: TOKEN, abi: ABI, signature: 'Transfer(address,address,uint256)', arguments: [ZERO, OWNER, '8000021'] }] };
}
export function policy() { return { gates: [{ id: 'TEST_ONLY_GATE', status: 'PASS' }], maxGasPerStep: '1000000', maxFeePerGas: '200', maxPriorityFeePerGas: '2', maxTotalWei: '100000000', maxAgeSeconds: 120, maxAgeBlocks: 2, confirmations: 1, finalityTag: 'finalized' }; }
export class FakeProvider {
  testOnly = true; calls = []; listeners = new Map(); chain = '0xaa36a7'; accounts = [OWNER]; nonce = '0x0'; code = '0x6000'; state = WORD;
  header = { number: '0x64', hash: BLOCK, timestamp: '0x6553f100', baseFeePerGas: '0x1' };
  receipts = new Map(); transactions = new Map(); sendError = null;
  on(name, fn) { this.listeners.set(name, fn); }
  removeListener(name) { this.listeners.delete(name); }
  emit(name) { this.listeners.get(name)?.(); }
  async request({ method, params = [] }) {
    this.calls.push({ method, params });
    if (this.hook) await this.hook(method, params);
    if (method === 'eth_chainId') return this.chain;
    if (method === 'eth_accounts') return this.accounts;
    if (method === 'eth_getBlockByNumber') return this.header;
    if (method === 'eth_getTransactionCount') return this.nonce;
    if (method === 'eth_getCode') return this.code;
    if (method === 'eth_call') return this.state;
    if (method === 'eth_estimateGas') return '0xc350';
    if (method === 'eth_getBalance') return '0x1000000000000000000';
    if (method === 'eth_getTransactionReceipt') return this.receipts.get(params[0]) ?? null;
    if (method === 'eth_getTransactionByHash') return this.transactions.get(params[0]) ?? null;
    if (method === 'eth_sendTransaction') { if (this.sendError) throw this.sendError; this.sent = params[0]; return HASH; }
    throw new Error('Unexpected RPC ' + method);
  }
  mine(p, hash = HASH) {
    const iface = new Interface(ABI), encoded = iface.encodeEventLog(iface.getEvent('Transfer'), [ZERO, OWNER, 8000021]);
    this.receipts.set(hash, { transactionHash: hash, from: OWNER, to: TOKEN, blockHash: BLOCK, blockNumber: '0x64', status: '0x1', gasUsed: '0xc350', effectiveGasPrice: '0x2', logs: [{ address: TOKEN, ...encoded, logIndex: '0x0' }] });
    this.transactions.set(hash, { hash, from: OWNER, to: TOKEN, blockHash: BLOCK, nonce: p.tx.nonce, value: '0x0', input: p.tx.data, chainId: p.tx.chainId, gas: p.tx.gas, maxFeePerGas: p.tx.maxFeePerGas, maxPriorityFeePerGas: p.tx.maxPriorityFeePerGas });
  }
}
export function fixture(packets = [packet()], overrides = {}) {
  const provider = new FakeProvider(); let persisted = null;
  const journal = { read: () => persisted, write: (x) => { persisted = JSON.parse(JSON.stringify(x)); } };
  const steps = packets.map(p => ({ id: p.id, packet: p, packetDigest: digest(p), maxCostWei: '10000000' }));
  const options = { provider, owner: OWNER, policy: policy(), steps, journal, testSubmission: true, now: () => 1700000000000, ...overrides };
  return { provider, journal, packets, steps, options, workflow: new DeploymentWorkflow(options), persisted: () => persisted };
}
