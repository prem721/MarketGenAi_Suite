import http.client, json

# simple helper that includes a session cookie after logging in
SESSION_COOKIE = None

def login():
    global SESSION_COOKIE
    conn = http.client.HTTPConnection('localhost',5000)
    headers={'Content-type':'application/x-www-form-urlencoded'}
    body='username=admin&password=admin'
    conn.request('POST','/login',body,headers)
    res=conn.getresponse()
    # capture cookie
    set_cookie = res.getheader('Set-Cookie')
    if set_cookie:
        SESSION_COOKIE = set_cookie.split(';',1)[0]
    print('login status', res.status, 'cookie', SESSION_COOKIE)


def test(payload):
    conn = http.client.HTTPConnection('localhost',5000)
    headers={'Content-type':'application/json'}
    if SESSION_COOKIE:
        headers['Cookie'] = SESSION_COOKIE
    conn.request('POST','/generate-campaign',json.dumps(payload),headers)
    res=conn.getresponse()
    print('payload',payload)
    print('status',res.status)
    print(res.read().decode()[:400])

if __name__=='__main__':
    test({'description':'Quick brief about a vegan snack on TikTok.'})
    test({'product':'Snack','audience':'Vegan','platform':'TikTok'})
