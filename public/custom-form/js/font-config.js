/**
 * Font family configuration for Froala editor
 * Includes Google Fonts and system fonts with CDN links
 */
(function () {
  // Google Fonts imports - add to <head> dynamically
  const GOOGLE_FONTS = [
    'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@300;400;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap',
  ];

  // Font family definitions - mapped as CSS value => Display name
  // (Froala uses keys as dropdown display text, values as CSS values)
  const FONT_FAMILIES = {
    // System fonts
    'Arial': 'Arial',
    'Helvetica': 'Helvetica',
    'Times New Roman': 'Times New Roman',
    'Courier New': 'Courier New',
    'Georgia': 'Georgia',
    'Verdana': 'Verdana',

    // Google Fonts - Modern/Sans-serif
    "'Roboto', sans-serif": 'Roboto',
    "'Poppins', sans-serif": 'Poppins',
    "'Sora', sans-serif": 'Sora',
    "'Open Sans', sans-serif": 'Open Sans',
    "'Lato', sans-serif": 'Lato',
    "'Montserrat', sans-serif": 'Montserrat',
    "'Raleway', sans-serif": 'Raleway',
    "'Inter', sans-serif": 'Inter',
    "'Nunito', sans-serif": 'Nunito',
    "'Source Sans Pro', sans-serif": 'Source Sans Pro',

    // Google Fonts - Serif/Display
    "'Playfair Display', serif": 'Playfair Display',
  };

  // Load Google Fonts into the document
  function loadGoogleFonts() {
    GOOGLE_FONTS.forEach(fontUrl => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = fontUrl;
      link.data_font_config = 'true'; // Mark as auto-loaded
      document.head.appendChild(link);
    });
  }

  // Initialize fonts when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadGoogleFonts);
  } else {
    loadGoogleFonts();
  }

  // Expose for Froala configuration
  window.FROALA_FONTS = FONT_FAMILIES;
})();
