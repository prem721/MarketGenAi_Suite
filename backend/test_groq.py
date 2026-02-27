import os
from dotenv import load_dotenv
from groq import Groq

# Load env
load_dotenv('.env')
api_key = os.getenv('GROQ_API_KEY')
print(f'API Key loaded: {api_key[:20]}...' if api_key else 'API Key: NOT FOUND')

# Test newer models (2024-2025)
models_to_test = [
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3.1-70b-versatile',
    'llama3.1-8b-instant',
    'deepseek-r1-distill-llama-70b',
]

client = Groq(api_key=api_key)

for model in models_to_test:
    try:
        response = client.chat.completions.create(
            messages=[{'role': 'user', 'content': 'Say hello in one word'}],
            model=model
        )
        print(f'✓ Model {model} works!')
        print(f'Response: {response.choices[0].message.content}')
        break
    except Exception as e:
        error_msg = str(e)[:100]
        print(f'✗ Model {model}: {error_msg}')
