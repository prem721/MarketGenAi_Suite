let currentCampaign = {
    product: '',
    audience: '',
    platform: '',
    content: ''
};

function generateCampaign() {
    const description = document.getElementById('description').value;
    const product = document.getElementById('product').value;
    const audience = document.getElementById('audience').value;
    const platform = document.getElementById('platform').value;
    const format = document.querySelector('input[name="campaignFormat"]:checked').value;

    let payload = { format: format };
    if (description) {
        payload.description = description;
    } else {
        if (!product || !audience || !platform) {
            alert('Please fill in all fields or provide a description');
            return;
        }
        payload.product = product;
        payload.audience = audience;
        payload.platform = platform;
    }

    document.getElementById('campaignOutput').innerText = 'Generating campaign... This may take a moment.';
    document.getElementById('downloadBtn').style.display = 'none';

    fetch('/generate-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (!data.campaign) {
                throw new Error('No campaign data received');
            }

            currentCampaign = {
                product: product,
                audience: audience,
                platform: platform,
                content: data.campaign
            };

            document.getElementById('campaignOutput').innerText = data.campaign;
            document.getElementById('downloadBtn').style.display = 'block';
        })
        .catch(error => {
            console.error('Error:', error);
            document.getElementById('campaignOutput').innerText = 'Error generating campaign: ' + error.message;
        });
}


function downloadPDF() {
    if (!currentCampaign.content) {
        alert('Please generate a campaign first');
        return;
    }

    document.getElementById('downloadBtn').innerText = 'Preparing PDF...';
    document.getElementById('downloadBtn').disabled = true;

    fetch('/download-campaign-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            product: currentCampaign.product,
            audience: currentCampaign.audience,
            platform: currentCampaign.platform,
            campaign_content: currentCampaign.content
        })
    })
        .then(res => res.blob())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Campaign_${currentCampaign.product.replace(/\s+/g, '_')}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            document.getElementById('downloadBtn').innerText = '📥 Download as PDF';
            document.getElementById('downloadBtn').disabled = false;
        })
        .catch(error => {
            alert('Error downloading PDF: ' + error.message);
            document.getElementById('downloadBtn').innerText = '📥 Download as PDF';
            document.getElementById('downloadBtn').disabled = false;
            console.error('Error:', error);
        });
}


function sendChatbotMessage(message) {
    const messagesDiv = document.getElementById('chatbot-messages');
    const userMsg = document.createElement('div');
    userMsg.className = 'chatbot-message chatbot-user-message';
    userMsg.textContent = message;
    messagesDiv.appendChild(userMsg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'chatbot-message chatbot-bot-message';
    loadingMsg.textContent = 'Thinking...';
    loadingMsg.id = 'loading-msg';
    messagesDiv.appendChild(loadingMsg);

    fetch('/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message })
    })
        .then(res => res.json())
        .then(data => {
            const loadingElement = document.getElementById('loading-msg');
            if (loadingElement) loadingElement.remove();

            const botMsg = document.createElement('div');
            botMsg.className = 'chatbot-message chatbot-bot-message';
            botMsg.textContent = data.response;
            messagesDiv.appendChild(botMsg);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;

            updateChatbotOptions(message);
        })
        .catch(error => {
            const loadingElement = document.getElementById('loading-msg');
            if (loadingElement) loadingElement.remove();

            const errorMsg = document.createElement('div');
            errorMsg.className = 'chatbot-message chatbot-bot-message';
            errorMsg.textContent = 'Sorry, I encountered an error. Please try again.';
            messagesDiv.appendChild(errorMsg);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });
}

function updateChatbotOptions(userMessage) {
    const optionsDiv = document.getElementById('chatbot-options');

    const followUpOptions = {
        'strategy': [
            'What tools should I use for campaign management?',
            'How do I measure campaign success?',
            'What are common marketing mistakes?'
        ],
        'social': [
            'How to create viral content?',
            'What posting schedule works best?',
            'How to increase engagement?'
        ],
        'audience': [
            'How to conduct market research?',
            'What are buyer personas?',
            'How to segment my audience?'
        ],
        'budget': [
            'How much should I spend on marketing?',
            'Which channels give best ROI?',
            'How to optimize ad spend?'
        ]
    };

    let optionsToShow = followUpOptions['strategy']; // default

    if (userMessage.toLowerCase().includes('social')) {
        optionsToShow = followUpOptions['social'];
    } else if (userMessage.toLowerCase().includes('audience')) {
        optionsToShow = followUpOptions['audience'];
    } else if (userMessage.toLowerCase().includes('budget')) {
        optionsToShow = followUpOptions['budget'];
    }

    optionsDiv.innerHTML = '';
    optionsToShow.forEach(option => {
        const btn = document.createElement('button');
        btn.className = 'chatbot-option-btn';
        btn.textContent = option;
        btn.onclick = () => sendChatbotMessage(option);
        optionsDiv.appendChild(btn);
    });
}

function closeChatbot() {
    document.getElementById('chatbot-widget').classList.add('hidden');
    document.getElementById('chatbot-toggle').classList.remove('hidden');
}

function toggleChatbot() {
    const widget = document.getElementById('chatbot-widget');
    const toggle = document.getElementById('chatbot-toggle');

    if (widget.classList.contains('hidden')) {
        widget.classList.remove('hidden');
        toggle.classList.add('hidden');
        document.getElementById('chatbot-input').focus();
    } else {
        widget.classList.add('hidden');
        toggle.classList.remove('hidden');
    }
}

function sendChatbotCustomMessage() {
    const inputElement = document.getElementById('chatbot-input');
    const message = inputElement.value.trim();

    if (!message) {
        return;
    }

    sendChatbotMessage(message);

    inputElement.value = '';
    inputElement.focus();
}

function handleChatbotKeypress(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendChatbotCustomMessage();
    }
}
