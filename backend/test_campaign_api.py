import requests

BASE = 'http://127.0.0.1:5000'

s = requests.Session()
# login as admin
r = s.post(f"{BASE}/login", data={'username':'admin','password':'admin'})
print('login status', r.status_code)

for payload in [
    {'description': 'Quick brief about a vegan snack on TikTok.'},
    {'product':'Snack','audience':'Vegan','platform':'TikTok'}
]:
    r2 = s.post(f"{BASE}/generate-campaign", json=payload)
    print('payload', payload)
    print('status', r2.status_code)
    print(r2.text[:500])
    print('-'*40)
