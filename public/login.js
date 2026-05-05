document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const submitBtn = document.getElementById('submitBtn');
    const toggleMode = document.getElementById('toggleMode');
    const errorBox = document.getElementById('errorBox');

    let isLoginMode = true;

    // Check if user is already logged in (has token)
    const token = localStorage.getItem('token');
    if (token) {
        window.location.href = 'chat.html';
    }

    toggleMode.addEventListener('click', (e) => {
        e.preventDefault();
        isLoginMode = !isLoginMode;
        if (isLoginMode) {
            submitBtn.textContent = 'Login';
            toggleMode.textContent = 'Need an account? Register here';
        } else {
            submitBtn.textContent = 'Register';
            toggleMode.textContent = 'Already have an account? Login here';
        }
        errorBox.style.display = 'none';
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        
        if (!username || !password) return;

        const endpoint = isLoginMode ? '/api/login' : '/api/register';
        submitBtn.textContent = 'Loading...';
        submitBtn.disabled = true;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('username', username);
                localStorage.setItem('token', data.token); // Save the JWT token
                window.location.href = 'chat.html';
            } else {
                errorBox.textContent = data.error || 'Authentication failed';
                errorBox.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = isLoginMode ? 'Login' : 'Register';
            }
        } catch (error) {
            errorBox.textContent = 'Network error. Please try again.';
            errorBox.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = isLoginMode ? 'Login' : 'Register';
        }
    });
});
