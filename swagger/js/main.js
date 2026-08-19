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

    const documentElement = document.documentElement;
    const themePresetSelect = document.getElementById('themePresetSelect');
    const themeStylesheet = document.getElementById('theme-stylesheet');

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const sunIcon = themeToggleBtn.querySelector('.sun-icon');
    const moonIcon = themeToggleBtn.querySelector('.moon-icon');

    const savedThemeMode = localStorage.getItem('themeMode') || 'dark';
    const savedThemePreset = localStorage.getItem('themePreset') || 'cyberpunk';

    setThemeMode(savedThemeMode);
    setThemePreset(savedThemePreset);

    themeToggleBtn.addEventListener('click', () => {
      const currentMode = document.documentElement.getAttribute('data-theme');
      const newMode = currentMode === 'dark' ? 'light' : 'dark';
      setThemeMode(newMode);
    });

    if (themePresetSelect) {
      themePresetSelect.addEventListener('change', (e) => {
        setThemePreset(e.target.value);
      });
    }

    function setThemeMode(mode) {
      documentElement.setAttribute('data-theme', mode);
      localStorage.setItem('themeMode', mode);
      if (mode === 'dark') {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      } else {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      }
    }

    function setThemePreset(preset) {
      documentElement.setAttribute('data-theme-preset', preset);
      localStorage.setItem('themePreset', preset);
      if (themePresetSelect) {
        themePresetSelect.value = preset;
        themeStylesheet.href = `swagger/css/themes/${preset}.css`;
      }
    }
    
};