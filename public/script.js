document.addEventListener('DOMContentLoaded', () => {
    const username = localStorage.getItem('username');
    
    const token = localStorage.getItem('token');
    
    // Redirect to login if not logged in
    if (!username || !token) {
        window.location.href = 'index.html';
        return;
    }

    // Update UI with username
    document.getElementById('displayUsername').textContent = username;

    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    const chatContainer = document.getElementById('chatContainer');
    const sendBtn = document.getElementById('sendBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const suggestionItems = document.querySelectorAll('.suggestion-item');
    const historyList = document.getElementById('historyList');

    const userProfileBtn = document.getElementById('userProfileBtn');
    const profileModal = document.getElementById('profileModal');
    const closeProfileModal = document.getElementById('closeProfileModal');
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const sidebar = document.getElementById('sidebar');

    let currentSessionId = 'sess_' + Date.now(); // Generate unique session ID

    if (hamburgerBtn && sidebar) {
        hamburgerBtn.addEventListener('click', () => {
            sidebar.classList.add('open');
        });
        closeSidebarBtn.addEventListener('click', () => {
            sidebar.classList.remove('open');
        });
    }

    // Profile Modal Logic
    if (userProfileBtn) {
        userProfileBtn.addEventListener('click', async (e) => {
            if(e.target.id === 'logoutBtn' || e.target.closest('#logoutBtn')) return;
            profileModal.style.display = 'block';
            
            try {
                const response = await fetch('/api/profile', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.ok) {
                    const data = await response.json();
                    document.getElementById('profUsername').textContent = data.username;
                    document.getElementById('profMessages').textContent = data.totalMessages;
                    document.getElementById('profSessions').textContent = data.totalSessions;
                }
            } catch(error) {
                console.error('Profile fetch failed', error);
            }
        });
    }

    if (closeProfileModal) {
        closeProfileModal.addEventListener('click', () => {
            profileModal.style.display = 'none';
        });
    }
    window.addEventListener('click', (e) => {
        if (e.target === profileModal) {
            profileModal.style.display = 'none';
        }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        
        // Enable/disable send button
        if (this.value.trim().length > 0) {
            sendBtn.removeAttribute('disabled');
            sendBtn.style.color = 'var(--primary-color)';
        } else {
            sendBtn.setAttribute('disabled', 'true');
            sendBtn.style.color = 'var(--text-muted)';
        }
    });

    // Handle Enter key to submit
    messageInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (this.value.trim().length > 0) {
                chatForm.dispatchEvent(new Event('submit'));
            }
        }
    });

    // Logout
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('username');
        localStorage.removeItem('token');
        window.location.href = 'index.html';
    });

    // New Chat
    newChatBtn.addEventListener('click', () => {
        currentSessionId = 'sess_' + Date.now();
        chatContainer.innerHTML = `
            <div class="message bot-message">
                <div class="message-content">
                    <div class="avatar bot-avatar"><i class="fa-solid fa-robot"></i></div>
                    <div class="text">Hello ${username}! I'm SmartEduBot, your College and Placement Assistance Chatbot. How can I help you today? We can practice DSA, Aptitude, or do a mock HR interview.</div>
                </div>
            </div>
        `;
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
    });

    // Suggestions
    suggestionItems.forEach(item => {
        item.addEventListener('click', () => {
            const prompt = item.getAttribute('data-prompt');
            messageInput.value = prompt;
            messageInput.dispatchEvent(new Event('input')); // Trigger resize and button state
        });
    });

    // Load Sessions list
    async function loadSessions() {
        try {
            const response = await fetch('/api/sessions', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                renderSessions(data.sessions);
                
                // Auto-load latest session if this is the initial load and it exists
                if (data.sessions && data.sessions.length > 0 && currentSessionId.startsWith('sess_') && chatContainer.children.length <= 1) {
                    loadHistory(data.sessions[0].id);
                }
            }
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    }

    function renderSessions(sessions) {
        historyList.innerHTML = '';
        if (!sessions) return;
        
        sessions.forEach(sess => {
            const div = document.createElement('div');
            div.className = 'history-item';
            if (sess.id === currentSessionId) div.classList.add('active');
            
            div.innerHTML = `<i class="fa-regular fa-message"></i> ${escapeHTML(sess.title)}`;
            div.addEventListener('click', () => loadHistory(sess.id));
            historyList.appendChild(div);
        });
    }

    // Load History for a specific session
    async function loadHistory(sessionId) {
        currentSessionId = sessionId;
        
        try {
            const response = await fetch(`/api/history?sessionId=${sessionId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.status === 401 || response.status === 403) {
                logoutBtn.click(); 
                return;
            }

            if (response.ok) {
                const data = await response.json();
                chatContainer.innerHTML = '';
                
                if (data.history && data.history.length > 0) {
                    data.history.forEach(msg => {
                        appendMessage(msg.role, msg.content, false);
                    });
                }
                scrollToBottom();
                
                // Update sidebar active states
                document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
                loadSessions(); // Simple way to refresh active state
            }
        } catch (error) {
            console.error('Failed to load history:', error);
        }
    }

    // Initialize sidebar
    loadSessions();

    // Form submit
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const message = messageInput.value.trim();
        if (!message) return;

        // Reset input
        messageInput.value = '';
        messageInput.style.height = 'auto';
        sendBtn.setAttribute('disabled', 'true');
        sendBtn.style.color = 'var(--text-muted)';

        // Add user message to UI
        appendMessage('user', message);

        // Show typing indicator
        const typingId = showTypingIndicator();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ message, sessionId: currentSessionId })
            });

            if (response.status === 401 || response.status === 403) {
                logoutBtn.click(); // Auto-logout if token is invalid
                return;
            }

            const data = await response.json();
            
            // Remove typing indicator
            removeElement(typingId);

            if (response.ok) {
                appendMessage('assistant', data.response);
                loadSessions(); // Refresh sidebar to show new session if it was created
            } else {
                appendMessage('assistant', `Error: ${data.error || 'Something went wrong'}`);
            }
        } catch (error) {
            removeElement(typingId);
            appendMessage('assistant', 'Sorry, I am having trouble connecting to the server.');
            console.error(error);
        }
    });

    function appendMessage(role, content, animate = true) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role === 'assistant' ? 'bot-message' : 'user-message'}`;
        
        const icon = role === 'assistant' 
            ? '<div class="avatar bot-avatar"><i class="fa-solid fa-robot"></i></div>' 
            : '<div class="avatar"><i class="fa-solid fa-user"></i></div>';

        // Parse markdown if it's the bot, otherwise just text
        const formattedContent = role === 'assistant' && typeof marked !== 'undefined' 
            ? marked.parse(content) 
            : `<p>${escapeHTML(content)}</p>`;

        messageDiv.innerHTML = `
            <div class="message-content">
                ${icon}
                <div class="text">${formattedContent}</div>
            </div>
        `;

        chatContainer.appendChild(messageDiv);
        scrollToBottom();
    }

    function showTypingIndicator() {
        const id = 'typing-' + Date.now();
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot-message';
        typingDiv.id = id;
        
        typingDiv.innerHTML = `
            <div class="message-content">
                <div class="avatar bot-avatar"><i class="fa-solid fa-robot"></i></div>
                <div class="text">
                    <div class="typing-indicator">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
            </div>
        `;

        chatContainer.appendChild(typingDiv);
        scrollToBottom();
        return id;
    }

    function removeElement(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }
});
