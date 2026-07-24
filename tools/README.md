# ROD tools

## `rod-rpc-cors-proxy.exe`

Local **CORS proxy** so the static browser wallet can call ROD Core JSON-RPC.

```
browser  →  http://127.0.0.1:18080/...  →  ROD Core http://127.0.0.1:11999/...
```

### Run

Double-click or:

```bat
tools\rod-rpc-cors-proxy.exe
```

Options:

```bat
rod-rpc-cors-proxy.exe --listen 18080 --bind 127.0.0.1 --target http://127.0.0.1:11999
```

### Wallet settings

In OTC → Settings → ROD Core RPC, use port **18080** (the proxy), not Core’s 11999:

```
http://xuser1:xpass1@127.0.0.1:18080/wallet/ROD
```

### Rebuild the .exe (dev)

```bat
cd tools
npm install
npm run build:exe
```

Requires Node.js only for building. The wallet itself stays a static offline page; the `.exe` is an optional local helper.
