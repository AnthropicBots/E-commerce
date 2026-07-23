// frontend/scripts/chat.js

// ==================== CHAT CONFIGURATION ====================
const CHAT_CONFIG = {
    MAX_MESSAGE_LENGTH: 1000,
    TYPING_TIMEOUT: 3000,
    RECONNECT_ATTEMPTS: 5,
    RECONNECT_DELAY: 1000,
    FILE_MAX_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain']
};

// ==================== STATE ====================
let chatSocket = null;
let chatConversationId = null;
let chatUnreadCount = 0;
let chatIsOpen = false;
let isConnected = false;
let typingTimeout = null;
let reconnectAttempts = 0;
let messages = [];
let typingUsers = new Set();
let currentFile = null;

// ==================== INITIALIZATION ====================
function injectChatWidget() {
    const user = AppUtils.getUser();
    if (!user || user.role === 'admin') return; // Only show for customers

    const chatHTML = `
        <div id="chat-widget-container">
            <button id="chat-widget-btn" class="chat-toggle-btn">
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
                        <button id="chat-minimize-btn" class="chat-action-btn"><i class="fas fa-minus"></i></button>
                        <button id="chat-close-btn" class="chat-action-btn"><i class="fas fa-times"></i></button>
                    </div>
                </div>

                <div class="chat-messages" id="chat-messages-container">
                    <div class="chat-system-message">
                        <i class="fas fa-comment"></i>
                        <p>👋 Hi!<br>How can we help you today?<br>Start a conversation below.</p>
                    </div>
                </div>

                <div class="chat-typing-indicator" id="chat-typing-indicator" style="display: none;">
                    <span class="typing-dots">
                        <span></span><span></span><span></span>
                    </span>
                    <span class="typing-text">Someone is typing...</span>
                </div>

                <div class="chat-input-area">
                    <div class="chat-input-actions">
                        <button id="chat-file-btn" class="chat-action-btn" title="Attach file">
                            <i class="fas fa-paperclip"></i>
                        </button>
                        <input type="file" id="chat-file-input" style="display: none;" accept=".jpg,.jpeg,.png,.gif,.pdf,.txt">
                    </div>
                    <textarea id="chat-input-textarea" placeholder="Type your message..." rows="1" disabled></textarea>
                    <button id="chat-send-btn" class="chat-send-btn" disabled>
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>

                <div class="chat-file-preview" id="chat-file-preview" style="display: none;">
                    <span id="chat-file-name"></span>
                    <button id="chat-file-remove" class="chat-action-btn"><i class="fas fa-times"></i></button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', chatHTML);

    // Event Listeners
    document.getElementById('chat-widget-btn').addEventListener('click', toggleChatWindow);
    document.getElementById('chat-minimize-btn').addEventListener('click', toggleChatWindow);
    document.getElementById('chat-close-btn').addEventListener('click', closeChatWindow);
    
    const textarea = document.getElementById('chat-input-textarea');
    textarea.addEventListener('input', handleTextareaInput);
    textarea.addEventListener('keydown', handleTextareaKeydown);

    document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);
    document.getElementById('chat-file-btn').addEventListener('click', () => {
        document.getElementById('chat-file-input').click();
    });
    document.getElementById('chat-file-input').addEventListener('change', handleFileSelect);
    document.getElementById('chat-file-remove').addEventListener('click', clearFilePreview);

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

// ==================== WINDOW CONTROLS ====================
function toggleChatWindow() {
    const windowEl = document.getElementById('chat-widget-window');
    chatIsOpen = !chatIsOpen;
    
    if (chatIsOpen) {
        windowEl.classList.add('open');
        chatUnreadCount = 0;
        document.getElementById('chat-unread-badge').style.display = 'none';
        scrollToBottom();
        document.getElementById('chat-input-textarea').focus();
        markMessagesAsRead();
    } else {
        windowEl.classList.remove('open');
    }
}

function closeChatWindow() {
    const windowEl = document.getElementById('chat-widget-window');
    windowEl.classList.remove('open');
    chatIsOpen = false;
}

// ==================== SOCKET CONNECTION ====================
function initChatSocket() {
    const token = AppUtils.getJSON(CONFIG.STORAGE_KEYS.TOKEN);
    if (!token) {
        updateChatStatus('Please login', '#dc3545');
        return;
    }

    const socketUrl = CONFIG.API_BASE.replace('/api', '');
    
    chatSocket = io(socketUrl, {
        auth: { token },
        reconnection: true,
        reconnectionAttempts: CHAT_CONFIG.RECONNECT_ATTEMPTS,
        reconnectionDelay: CHAT_CONFIG.RECONNECT_DELAY,
        reconnectionDelayMax: 5000
    });

    // ===== Socket Event Handlers =====
    chatSocket.on('connect', () => {
        console.log('Chat socket connected');
        isConnected = true;
        reconnectAttempts = 0;
        updateChatStatus('Online', '#4caf50');
        enableChatInput(true);
        
        chatSocket.emit('join_conversation', {}, (res) => {
            if (res && res.success) {
                chatConversationId = res.conversationId;
                loadPreviousMessages();
                getUnreadCount();
            }
        });
    });

    chatSocket.on('disconnect', () => {
        console.log('Chat socket disconnected');
        isConnected = false;
        updateChatStatus('Disconnected', '#dc3545');
        enableChatInput(false);
    });

    chatSocket.on('connect_error', (error) => {
        console.error('Chat connection error:', error);
        reconnectAttempts++;
        if (reconnectAttempts >= CHAT_CONFIG.RECONNECT_ATTEMPTS) {
            updateChatStatus('Connection failed', '#dc3545');
            enableChatInput(false);
        }
    });

    chatSocket.on('message_received', (msg) => {
        renderMessage(msg);
        markMessagesAsRead();
        if (!chatIsOpen) {
            chatUnreadCount++;
            updateUnreadBadge();
        }
        playNotificationSound();
    });

    chatSocket.on('message_read', (data) => {
        updateMessageReadStatus(data);
    });

    chatSocket.on('message_edited', (data) => {
        updateMessageContent(data);
    });

    chatSocket.on('message_deleted', (data) => {
        removeMessage(data.messageId);
    });

    chatSocket.on('user_typing', (data) => {
        showTypingIndicator(data.userId);
    });

    chatSocket.on('user_stopped_typing', (data) => {
        hideTypingIndicator(data.userId);
    });

    chatSocket.on('room_participants', (participants) => {
        updateRoomParticipants(participants);
    });

    chatSocket.on('error', (data) => {
        AppUtils.notify(data.message || 'Chat error occurred', 'error');
    });

    chatSocket.on('heartbeat_timeout', () => {
        console.warn('Heartbeat timeout, reconnecting...');
        chatSocket.connect();
    });
}

// ==================== MESSAGE HANDLING ====================
function sendChatMessage() {
    const textarea = document.getElementById('chat-input-textarea');
    const text = textarea.value.trim();
    
    if (!text && !currentFile) return;
    if (!chatSocket || !chatConversationId) {
        AppUtils.notify('Not connected to chat', 'error');
        return;
    }

    const messageData = {
        conversationId: chatConversationId,
        message: text || '',
        file: currentFile || null
    };

    // Clear input
    textarea.value = '';
    textarea.style.height = 'auto';
    clearFilePreview();

    // Stop typing indicator
    chatSocket.emit('stop_typing', { roomId: `conversation:${chatConversationId}` });

    // Send message
    chatSocket.emit('send_message', messageData, (res) => {
        if (!res || !res.success) {
            AppUtils.notify('Failed to send message', 'error');
        }
    });
}

function renderMessage(msg) {
    const container = document.getElementById('chat-messages-container');
    const isCustomer = msg.sender_type === 'customer';
    const isOwnMessage = msg.sender_id === AppUtils.getUser()?.id;
    
    // Remove system message if this is first message
    const systemMsg = container.querySelector('.chat-system-message');
    if (systemMsg) {
        systemMsg.remove();
    }

    const div = document.createElement('div');
    div.className = `chat-message ${isOwnMessage ? 'own' : 'other'}`;
    div.dataset.messageId = msg.id;
    
    let content = `
        <div class="message-bubble">
            ${msg.file ? renderFileContent(msg.file) : ''}
            <p class="message-text">${AppUtils.escapeHTML(msg.message)}</p>
            <span class="message-time">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            ${msg.is_edited ? '<span class="edited-badge">(edited)</span>' : ''}
            ${isOwnMessage ? `<span class="message-status">${msg.is_read ? '✓✓' : '✓'}</span>` : ''}
        </div>
    `;
    
    if (!isOwnMessage) {
        content = `
            <div class="message-avatar">
                <i class="fas fa-user"></i>
            </div>
            <div class="message-info">
                <span class="message-sender">${msg.sender_name || 'User'}</span>
                ${content}
            </div>
        `;
    }
    
    div.innerHTML = content;
    container.appendChild(div);
    scrollToBottom();
}

function renderFileContent(file) {
    if (!file) return '';
    
    if (file.type && file.type.startsWith('image/')) {
        return `<img src="${file.url || file.data}" alt="${file.name}" class="message-image" />`;
    } else {
        return `
            <div class="file-attachment">
                <i class="fas fa-file"></i>
                <span class="file-name">${file.name}</span>
                <span class="file-size">${formatFileSize(file.size)}</span>
                <a href="${file.url || file.data}" download="${file.name}" class="download-link">
                    <i class="fas fa-download"></i>
                </a>
            </div>
        `;
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==================== TYPING INDICATOR ====================
function handleTextareaInput() {
    const textarea = document.getElementById('chat-input-textarea');
    if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    // Typing indicator
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }

    if (textarea.value.trim().length > 0) {
        chatSocket.emit('typing', { roomId: `conversation:${chatConversationId}` });
    }

    typingTimeout = setTimeout(() => {
        chatSocket.emit('stop_typing', { roomId: `conversation:${chatConversationId}` });
    }, CHAT_CONFIG.TYPING_TIMEOUT);
}

function handleTextareaKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

function showTypingIndicator(userId) {
    typingUsers.add(userId);
    const indicator = document.getElementById('chat-typing-indicator');
    if (indicator) {
        indicator.style.display = 'block';
        const text = indicator.querySelector('.typing-text');
        if (text) {
            text.textContent = `${typingUsers.size} ${typingUsers.size === 1 ? 'person is' : 'people are'} typing...`;
        }
    }
}

function hideTypingIndicator(userId) {
    typingUsers.delete(userId);
    const indicator = document.getElementById('chat-typing-indicator');
    if (indicator && typingUsers.size === 0) {
        indicator.style.display = 'none';
    }
}

// ==================== FILE HANDLING ====================
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file
    if (!CHAT_CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
        AppUtils.notify('File type not supported', 'error');
        e.target.value = '';
        return;
    }

    if (file.size > CHAT_CONFIG.FILE_MAX_SIZE) {
        AppUtils.notify('File size exceeds 5MB limit', 'error');
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        currentFile = {
            name: file.name,
            type: file.type,
            size: file.size,
            data: event.target.result
        };
        showFilePreview(currentFile);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

function showFilePreview(file) {
    const preview = document.getElementById('chat-file-preview');
    const nameEl = document.getElementById('chat-file-name');
    if (preview && nameEl) {
        nameEl.textContent = `📎 ${file.name} (${formatFileSize(file.size)})`;
        preview.style.display = 'flex';
    }
}

function clearFilePreview() {
    currentFile = null;
    const preview = document.getElementById('chat-file-preview');
    if (preview) {
        preview.style.display = 'none';
        document.getElementById('chat-file-name').textContent = '';
    }
}

// ==================== MESSAGE READ STATUS ====================
function markMessagesAsRead() {
    if (!chatConversationId || !chatSocket) return;
    
    const container = document.getElementById('chat-messages-container');
    const unreadMessages = container.querySelectorAll('.message:not(.own) .message-status:not(.read)');
    
    unreadMessages.forEach(el => {
        const messageId = el.closest('.chat-message')?.dataset.messageId;
        if (messageId) {
            chatSocket.emit('message_read', {
                messageId,
                conversationId: chatConversationId
            });
        }
    });
}

function updateMessageReadStatus(data) {
    const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageEl) {
        const status = messageEl.querySelector('.message-status');
        if (status) {
            status.textContent = '✓✓';
            status.classList.add('read');
        }
    }
}

function updateMessageContent(data) {
    const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageEl) {
        const text = messageEl.querySelector('.message-text');
        if (text) {
            text.textContent = AppUtils.escapeHTML(data.newMessage);
        }
        const badge = messageEl.querySelector('.edited-badge');
        if (!badge) {
            const time = messageEl.querySelector('.message-time');
            if (time) {
                const badgeSpan = document.createElement('span');
                badgeSpan.className = 'edited-badge';
                badgeSpan.textContent = '(edited)';
                time.after(badgeSpan);
            }
        }
    }
}

function removeMessage(messageId) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageEl) {
        messageEl.remove();
    }
}

// ==================== MESSAGE HISTORY ====================
async function loadPreviousMessages() {
    if (!chatConversationId) return;
    
    try {
        const res = await AppUtils.apiRequest(`/chat/conversations/${chatConversationId}`);
        if (res.success && res.messages.length > 0) {
            const container = document.getElementById('chat-messages-container');
            container.innerHTML = '';
            res.messages.forEach(renderMessage);
            scrollToBottom();
        }
    } catch (e) {
        console.error('Failed to load message history:', e);
    }
}

async function getUnreadCount() {
    try {
        const res = await AppUtils.apiRequest(`/chat/unread-count`);
        if (res.success && res.count > 0) {
            chatUnreadCount = res.count;
            updateUnreadBadge();
        }
    } catch (e) {
        console.error('Failed to get unread count:', e);
    }
}

// ==================== UI UPDATES ====================
function updateChatStatus(text, color) {
    const statusEl = document.getElementById('chat-connection-status');
    if (statusEl) {
        statusEl.innerHTML = `<span class="chat-status-dot" style="background: ${color};"></span> ${text}`;
    }
}

function updateUnreadBadge() {
    const badge = document.getElementById('chat-unread-badge');
    if (badge) {
        if (chatUnreadCount > 0) {
            badge.innerText = chatUnreadCount > 99 ? '99+' : chatUnreadCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function enableChatInput(enabled) {
    const textarea = document.getElementById('chat-input-textarea');
    const sendBtn = document.getElementById('chat-send-btn');
    if (textarea) textarea.disabled = !enabled;
    if (sendBtn) sendBtn.disabled = !enabled;
}

function scrollToBottom() {
    const container = document.getElementById('chat-messages-container');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function updateRoomParticipants(participants) {
    // Update UI with room participants if needed
}

function playNotificationSound() {
    try {
        const audio = new Audio('/sounds/notification.mp3');
        audio.volume = 0.3;
        audio.play().catch(() => {});
    } catch (e) {
        // Silent fail if audio not available
    }
}

// ==================== INITIALIZATION ====================
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(injectChatWidget, 500);
});

// ==================== EXPORTS ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initChatSocket,
        sendChatMessage,
        toggleChatWindow,
        closeChatWindow
    };
}