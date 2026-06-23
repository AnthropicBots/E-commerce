// Chat Widget Logic
let chatSocket = null;
let chatConversationId = null;
let chatUnreadCount = 0;
let chatIsOpen = false;

function injectChatWidget() {
    const user = AppUtils.getUser();
    if (!user || user.role === 'admin') return; // Only show for customers

    const chatHTML = `
        <div id="chat-widget-container">
            <button id="chat-widget-btn">
                <i class="fas fa-comment-dots"></i>
                <span class="chat-unread-badge" id="chat-unread-badge" style="display: none;">0</span>
            </button>

            <div id="chat-widget-window">
                <div class="chat-header">
                    <div class="chat-header-info">
                        <div class="chat-avatar"><i class="fas fa-headset"></i></div>
                        <div class="chat-title">
                            Customer Support
                            <div class="chat-status" id="chat-connection-status">
                                <span class="chat-status-dot" style="background: #ff9800;"></span> Connecting...
                            </div>
                        </div>
                    </div>
                    <div class="chat-actions">
                        <button id="chat-minimize-btn"><i class="fas fa-minus"></i></button>
                    </div>
                </div>

                <div class="chat-messages" id="chat-messages-container">
                    <div class="chat-system-message">
                        👋 Hi!<br>How can we help you today?<br>Start a conversation below.
                    </div>
                </div>

                <div class="chat-input-area">
                    <textarea id="chat-input-textarea" placeholder="Type your message..." rows="1" disabled></textarea>
                    <button id="chat-send-btn" disabled><i class="fas fa-paper-plane"></i></button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', chatHTML);

    // Event Listeners
    document.getElementById('chat-widget-btn').addEventListener('click', toggleChatWindow);
    document.getElementById('chat-minimize-btn').addEventListener('click', toggleChatWindow);
    
    const textarea = document.getElementById('chat-input-textarea');
    textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);

    // Load socket.io script
    if (typeof io === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = initChatSocket;
        document.head.appendChild(script);
    } else {
        initChatSocket();
    }
}

function toggleChatWindow() {
    const windowEl = document.getElementById('chat-widget-window');
    chatIsOpen = !chatIsOpen;
    
    if (chatIsOpen) {
        windowEl.classList.add('open');
        chatUnreadCount = 0;
        document.getElementById('chat-unread-badge').style.display = 'none';
        scrollToBottom();
        document.getElementById('chat-input-textarea').focus();
    } else {
        windowEl.classList.remove('open');
    }
}

function initChatSocket() {
    const token = AppUtils.getJSON(CONFIG.STORAGE_KEYS.TOKEN);
    if (!token) return;

    chatSocket = io(CONFIG.API_BASE.replace('/api', ''), {
        auth: { token }
    });

    chatSocket.on('connect', () => {
        updateChatStatus('Online', '#4caf50');
        document.getElementById('chat-input-textarea').disabled = false;
        document.getElementById('chat-send-btn').disabled = false;
        
        chatSocket.emit('join_conversation', {}, (res) => {
            if (res.success) {
                chatConversationId = res.conversationId;
                loadPreviousMessages();
            }
        });
    });

    chatSocket.on('disconnect', () => {
        updateChatStatus('Disconnected', '#dc3545');
        document.getElementById('chat-input-textarea').disabled = true;
        document.getElementById('chat-send-btn').disabled = true;
    });

    chatSocket.on('message_received', (msg) => {
        renderMessage(msg);
        if (!chatIsOpen) {
            chatUnreadCount++;
            const badge = document.getElementById('chat-unread-badge');
            badge.innerText = chatUnreadCount;
            badge.style.display = 'flex';
        }
    });
}

function updateChatStatus(text, color) {
    const statusEl = document.getElementById('chat-connection-status');
    if (statusEl) {
        statusEl.innerHTML = `<span class="chat-status-dot" style="background: ${color};"></span> ${text}`;
    }
}

async function loadPreviousMessages() {
    if (!chatConversationId) return;
    try {
        const res = await AppUtils.apiRequest(`/chat/conversations/${chatConversationId}`);
        if (res.success && res.messages.length > 0) {
            const container = document.getElementById('chat-messages-container');
            container.innerHTML = ''; // clear welcome message
            res.messages.forEach(renderMessage);
        }
    } catch (e) {
        console.error("Failed to load history", e);
    }
}

function renderMessage(msg) {
    const container = document.getElementById('chat-messages-container');
    const isCustomer = msg.sender_type === 'customer';
    const div = document.createElement('div');
    div.className = `chat-message ${isCustomer ? 'customer' : 'admin'}`;
    div.innerHTML = `
        ${AppUtils.escapeHTML(msg.message)}
        <span class="chat-message-time">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
    `;
    container.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    const container = document.getElementById('chat-messages-container');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function sendChatMessage() {
    const textarea = document.getElementById('chat-input-textarea');
    const text = textarea.value.trim();
    if (!text || !chatSocket || !chatConversationId) return;

    textarea.value = '';
    textarea.style.height = 'auto';

    chatSocket.emit('send_message', { conversationId: chatConversationId, message: text }, (res) => {
        if (!res.success) {
            AppUtils.notify("Failed to send message", "error");
        }
    });
}

// Initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    // wait a moment so AppUtils is ready
    setTimeout(injectChatWidget, 500);
});
