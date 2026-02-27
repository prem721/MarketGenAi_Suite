import requests

BASE = 'http://127.0.0.1:5000'
USERNAME = 'admin'
PASSWORD = 'admin'

s = requests.Session()
# Login with form data
r = s.post(f"{BASE}/login", data={'username': USERNAME, 'password': PASSWORD}, allow_redirects=False)
print('Login status:', r.status_code)
if r.status_code in (302, 303):
    print('Login appears successful (redirect). Cookies:', s.cookies.get_dict())
else:
    print('Login response:', r.text[:200])

# Rotate key (test key)
new_key = 'sk-TEST-ROTATE-123456'
r2 = s.post(f"{BASE}/admin/rotate-stability-key", json={'key': new_key})
print('Rotate response status:', r2.status_code)
try:
    print('Rotate response JSON:', r2.json())
except Exception:
    print('Rotate response text:', r2.text)

# Check key
r3 = s.get(f"{BASE}/admin/check-stability-key")
print('Check response status:', r3.status_code)
try:
    print('Check response JSON:', r3.json())
except Exception:
    print('Check response text:', r3.text)
