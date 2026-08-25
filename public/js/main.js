window.onload = function () {
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
  const sunIcon = themeToggleBtn ? themeToggleBtn.querySelector('.sun-icon') : null;
  const moonIcon = themeToggleBtn ? themeToggleBtn.querySelector('.moon-icon') : null;

  const appDefault = {
    mode: 'dark',
    theme: 'cyberpunk'
  };

  const savedThemeMode = localStorage.getItem('themeMode') || appDefault.mode;
  const savedThemePreset = localStorage.getItem('themePreset') || appDefault.theme;
  if (appDefault.mode !== savedThemeMode) {
    setThemeMode(savedThemeMode);
  }
  if (appDefault.theme !== savedThemePreset) {
    setThemePreset(savedThemePreset);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentMode = documentElement.getAttribute('data-theme');
      const newMode = currentMode === 'dark' ? 'light' : 'dark';
      setThemeMode(newMode);
    });
  }

  if (themePresetSelect) {
    themePresetSelect.addEventListener('change', (e) => {
      setThemePreset(e.target.value);
    });
  }

  function setThemeMode(mode) {
    documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('themeMode', mode);
    if (sunIcon && moonIcon) {
      if (mode === 'dark') {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      } else {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      }
    }
  }

  function setThemePreset(preset) {
    documentElement.setAttribute('data-theme-preset', preset);
    localStorage.setItem('themePreset', preset);
    if (themePresetSelect) {
      themePresetSelect.value = preset;
      themeStylesheet.href = `css/themes/${preset}.css`;
    }
  }
};