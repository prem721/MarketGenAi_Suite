import os
from dotenv import load_dotenv
BASE = os.path.dirname(__file__)
load_dotenv(os.path.join(BASE, '.env'), override=True)
print('STABILITY_API_KEY->', repr(os.getenv('STABILITY_API_KEY')))
