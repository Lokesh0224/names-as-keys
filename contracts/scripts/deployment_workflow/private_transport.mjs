/** Browser transport for one operation on the same loopback review server. */
export function privateEstimator(location, fetcher = fetch) {
  return async (tx, header) => {
    if (location?.protocol !== 'http:' || location.hostname !== '127.0.0.1')
      throw new Error('Private estimation requires the loopback review server');
    const response = await fetcher('/private-estimate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx, header: { number: header.number, hash: header.hash } }),
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error('Private estimate unavailable');
    const { gas } = await response.json();
    if (!/^0x[1-9a-f][0-9a-f]*$/.test(gas)) throw new Error('Private estimate invalid');
    return gas;
  };
}
