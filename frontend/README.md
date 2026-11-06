# Names as Keys · Stage 3G

From the repository root with Node.js 22.18 or later:

```sh
cd frontend
npm ci
cp .env.example .env
npm start
```

Open [Owner](http://127.0.0.1:8787/owner) and [Door display](http://127.0.0.1:8787/door) in separate tabs. Connect the demo owner, issue Mira's five-minute credential, then scan the demo QR or open its guest link. Connect demo Mira and tap **Unlock**. The door display shows the synthetic event and returns to **LOCKED** after eight seconds by default. Revoke from the owner tab and try unlocking again. The kiosk records the demo denial separately and retains the latest authorized unlock. **Reset demo** clears the shared in-memory session.

For a phone on the same Wi-Fi, set `NAK_HOST=0.0.0.0` and `NAK_PUBLIC_ORIGIN=http://YOUR_LAPTOP_LAN_IP:8787` in `.env`, restart, and open that origin on the laptop before scanning. Demo wallets are role selectors. The demo uses one shared, disposable session per server and sends no wallet requests.

Run `npm test` for the HTTP lifecycle, routing, expiry, wallet ownership, stale revocation, and missing Sepolia configuration checks.

## Sepolia integration

Use the Sepolia fields in [.env.example](.env.example) after the approved deployment. The server needs the T14 receipt hash, reviewed DoorKeys and CredentialRegistrar runtime hashes, actual deployment addresses, selected public wallet addresses, a server-side Sepolia RPC URL and the stable HTTPS origin that will appear on the printed QR. It checks the receipt, runtime hash and door/registrar context at startup. Set `NAK_GUEST_URL` to the confirmed public URL, including `/guest?door=<doorId>&chain=11155111&contract=<checksummed DoorKeys address>`. The QR and actions become available after the configuration checks pass.

Sepolia mode reads ENSv2 credential ownership, expiry and status and calls DoorKeys read-only to check eligibility. Issue, revoke and unlock each run a fresh contract preflight, then require separate approval in MetaMask. The server provides unsigned calldata only. The registrar permits issuance only for a pristine label. If T15 has already issued Mira's credential, the dashboard can revoke it while active, but it cannot issue that label again after expiry or revocation.

The kiosk presents canonical `DoorUnlocked` events after two confirmations and relocks its display after eight seconds by default. A pending transaction or a wallet confirmation alone does not open the kiosk. If transaction confirmation times out, the page retains the hash and blocks further writes in that tab. Check the transaction in MetaMask before reloading.
