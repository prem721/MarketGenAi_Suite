Stability key rotation and validation

Use the admin endpoints to rotate and check the `STABILITY_API_KEY`.

1) Start the server (if not running):

```bash
venv\Scripts\python.exe backend\app.py
```

2) Log in via the UI at http://127.0.0.1:5000/login (default admin/admin)

3) Rotate the key (authenticated session required). Example using `curl` with a cookie file:

```bash
# Store cookies after logging in (example):
# Use your browser login or an earlier curl that posts form data and saves cookies
curl -c cookiejar.txt -d "username=admin&password=admin" -X POST http://127.0.0.1:5000/login

# Rotate with new key
curl -b cookiejar.txt -H "Content-Type: application/json" \
  -d '{"key":"sk-NEW-KEY-HERE"}' \
  -X POST http://127.0.0.1:5000/admin/rotate-stability-key
```

4) Validate the key:

```bash
curl -b cookiejar.txt http://127.0.0.1:5000/admin/check-stability-key
```

Notes
- The rotate endpoint persists the key to `backend/.env` and updates the running process.
- Validation uses `https://api.stability.ai/v1/user/account`; if your account requires a different validation, let me know and I can change the check to perform a small generation test (may consume quota).
- For CI or automation, prefer rotating via a secure vault and writing the `.env` file safely.
