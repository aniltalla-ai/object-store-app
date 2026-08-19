window.onload = function () {
    // Initialize Swagger UI
    const ui = SwaggerUIBundle({
        url: "./openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout"
    });
    window.ui = ui;

    // Theme Preset Switching Logic
    const presetSelect = document.getElementById('themePresetSelect');
    const themeStylesheet = document.getElementById('theme-stylesheet');
    const htmlTag = document.documentElement;

    presetSelect.addEventListener('change', (e) => {
        const selectedPreset = e.target.value;
        const previousPreset = htmlTag.getAttribute('data-theme-preset');
        htmlTag.setAttribute('data-theme-preset', selectedPreset);
        themeStylesheet.href = themeStylesheet.href.replace(previousPreset, selectedPreset);
        localStorage.setItem('api_theme_preset', selectedPreset);
    });

    // Light/Dark Mode Toggle Logic
    const toggleBtn = document.getElementById('themeToggleBtn');
    toggleBtn.addEventListener('click', () => {
        const currentTheme = htmlTag.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        htmlTag.setAttribute('data-theme', newTheme);
        localStorage.setItem('api_theme_mode', newTheme);
    });

    // Restore Saved Preferences
    const savedPreset = localStorage.getItem('api_theme_preset');
    const savedMode = localStorage.getItem('api_theme_mode');
    if (savedPreset) {
        themeStylesheet.href = themeStylesheet.href.replace(presetSelect.value, savedPreset);
        presetSelect.value = savedPreset;
        htmlTag.setAttribute('data-theme-preset', savedPreset);
    }
    if (savedMode) {
        htmlTag.setAttribute('data-theme', savedMode);
    }
};