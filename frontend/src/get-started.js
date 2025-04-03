export function initGetStartedGuide() {
    const modal = document.getElementById('get-started-modal-overlay');
    const closeBtn = document.getElementById('close-get-started-modal');
    const dontShowAgain = document.getElementById('dont-show-again');
    const backBtn = document.getElementById('get-started-back-btn');
    const nextBtn = document.getElementById('get-started-next-btn');
    const finishBtn = document.getElementById('get-started-finish-btn');
    const tabButtons = document.querySelectorAll('.get-started-tab-btn');
    const tabs = document.querySelectorAll('.get-started-tab');
    
    if (!modal) {
      console.error('Get Started modal not found');
      return;
    }
    
    // Check if we should show the guide
    const shouldShowGuide = !localStorage.getItem('dontShowGetStartedGuide');
    
    // Create a Help button in the header
    const createHelpButton = () => {
      const header = document.querySelector('.header');
      if (!header) return;
      
      // Check if button already exists
      if (document.getElementById('help-button')) return;
      
      const helpButton = document.createElement('button');
      helpButton.id = 'help-button';
      helpButton.className = 'help-button';
      helpButton.innerHTML = '<i class="fas fa-question-circle"></i>&nbsp; Help';
      
      // Insert before emergency stop button
      const emergencyStop = document.querySelector('.emergency-stop-container');
      if (emergencyStop) {
        header.insertBefore(helpButton, emergencyStop);
      } else {
        header.appendChild(helpButton);
      }
      
      // Add event listener
      helpButton.addEventListener('click', showGetStartedGuide);
    };
    
    // Show the guide
    function showGetStartedGuide() {
      modal.style.display = 'flex';
      
      // Reset to the first tab
      activateTab(0);
    }
    
    // Close the guide
    function closeGetStartedGuide() {
      modal.style.display = 'none';
      
      // Save preference if "Don't show again" is checked
      if (dontShowAgain && dontShowAgain.checked) {
        localStorage.setItem('dontShowGetStartedGuide', 'true');
      }
    }
    
    // Activate a specific tab by index
    function activateTab(index) {
      // Disable all tabs
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabs.forEach(tab => tab.classList.remove('active'));
      
      // Activate the selected tab
      if (tabButtons[index]) tabButtons[index].classList.add('active');
      if (tabs[index]) tabs[index].classList.add('active');
      
      // Update back/next buttons
      backBtn.disabled = index === 0;
      
      if (index === tabButtons.length - 1) {
        // On the last tab, show Finish button instead of Next
        nextBtn.style.display = 'none';
        finishBtn.style.display = 'inline-block';
      } else {
        nextBtn.style.display = 'inline-block';
        finishBtn.style.display = 'none';
      }
    }
    
    // Set up event listeners
    if (closeBtn) {
      closeBtn.addEventListener('click', closeGetStartedGuide);
    }
    
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        // Find current active tab
        const activeTabIndex = [...tabButtons].findIndex(btn => btn.classList.contains('active'));
        if (activeTabIndex > 0) {
          activateTab(activeTabIndex - 1);
        }
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        // Find current active tab
        const activeTabIndex = [...tabButtons].findIndex(btn => btn.classList.contains('active'));
        if (activeTabIndex < tabButtons.length - 1) {
          activateTab(activeTabIndex + 1);
        }
      });
    }
    
    if (finishBtn) {
      finishBtn.addEventListener('click', closeGetStartedGuide);
    }
    
    // Set up tab button click events
    tabButtons.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        activateTab(index);
      });
    });
    
    // Show the guide on first launch if not disabled
    if (shouldShowGuide) {
      // Use a small delay to ensure the app is fully loaded
      setTimeout(showGetStartedGuide, 1000);
    }
    
    // Create the help button
    createHelpButton();
  }
  
  // Function to create placeholder images for the Get Started guide
  // Only needed until you have real screenshots of your application
  export function createPlaceholderImages() {
    const helpDir = '../src/assets/help';
    
    // Create the directory if it doesn't exist
    const fs = window.require('fs');
    const path = window.require('path');
    
    if (!fs.existsSync(helpDir)) {
      fs.mkdirSync(helpDir, { recursive: true });
    }
    
    // List of images to create
    const images = [
      { name: 'connection-panel.png', width: 300, height: 250 },
      { name: 'control-panel.png', width: 300, height: 250 },
      { name: 'gcode-tab.png', width: 300, height: 250 },
      { name: 'cad-tab.png', width: 300, height: 250 }
    ];
    
    // For each image, create a canvas element and save it
    images.forEach(img => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      
      // Fill background
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw border
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
      
      // Draw text
      ctx.fillStyle = '#333';
      ctx.font = '16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(img.name.replace('.png', ''), canvas.width / 2, canvas.height / 2);
      
      // Convert to data URL
      const dataUrl = canvas.toDataURL('image/png');
      
      // Remove data:image/png;base64, prefix
      const data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(data, 'base64');
      
      // Save to file
      fs.writeFileSync(path.join(helpDir, img.name), buf);
    });
  }