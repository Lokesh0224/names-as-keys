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

Use the Sepolia fields in [.env.example](.env.example) after the approved deployment. The server needs the T14 receipt hash, reviewed DoorKeys runtime hash, actual deployment addresses, selected public wallet addresses, a server-side Sepolia RPC URL and the stable HTTPS origin that will appear on the printed QR. It checks the receipt, runtime hash and door/registrar context at startup. The QR routes to the verified door ID, chain and contract address.

Sepolia mode reads ENSv2 registry state and DoorKeys logs. It uses a read-only DoorKeys call to check wallet eligibility. Issue, revoke and unlock submissions remain disabled pending deployment authorization and a separately authorized live wallet integration. Kiosk relocking is a display timer.
