export function initGetStartedGuide() {
  const modal = document.getElementById('get-started-modal-overlay');
  const closeBtn = document.getElementById('close-get-started-modal');
  const dontShowAgain = document.getElementById('dont-show-again');
  const backBtn = document.getElementById('get-started-back-btn');
  const nextBtn = document.getElementById('get-started-next-btn');
  const finishBtn = document.getElementById('get-started-finish-btn');
  const tabButtons = document.querySelectorAll('.get-started-tab-btn');
  const tabs = document.querySelectorAll('.get-started-tab');
  
  console.log('Get Started modal elements:', { 
    modal, closeBtn, backBtn, nextBtn, finishBtn,
    tabButtons: tabButtons.length,
    tabs: tabs.length
  });
  
  if (!modal) {
    console.error('Get Started modal not found');
    return;
  }
  
  // Check if we should show the guide
  const shouldShowGuide = !localStorage.getItem('dontShowGetStartedGuide');
  console.log('Should show Get Started guide:', shouldShowGuide);
  
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
    console.log('Help button created and added to header');
  };
  
  // Show the guide
  function showGetStartedGuide() {
    console.log('Showing Get Started guide');
    modal.classList.add('active'); // Use class instead of style.display
    
    // Reset to the first tab
    activateTab(0);
  }
  
  // Close the guide
  function closeGetStartedGuide() {
    console.log('Closing Get Started guide');
    modal.classList.remove('active'); // Use class instead of style.display
    
    // Save preference if "Don't show again" is checked
    if (dontShowAgain && dontShowAgain.checked) {
      localStorage.setItem('dontShowGetStartedGuide', 'true');
      console.log('Set preference to not show guide again');
    }
  }
  
  // Activate a specific tab by index
  function activateTab(index) {
    console.log('Activating tab index:', index);
    
    // Disable all tabs
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Activate the selected tab
    if (tabButtons[index]) tabButtons[index].classList.add('active');
    if (tabs[index]) tabs[index].classList.add('active');
    
    // Update back/next buttons
    if (backBtn) backBtn.disabled = index === 0;
    
    if (index === tabButtons.length - 1) {
      // On the last tab, show Finish button instead of Next
      if (nextBtn) nextBtn.style.display = 'none';
      if (finishBtn) finishBtn.style.display = 'inline-block';
    } else {
      if (nextBtn) nextBtn.style.display = 'inline-block';
      if (finishBtn) finishBtn.style.display = 'none';
    }
  }
  
  // Set up event listeners
  if (closeBtn) {
    closeBtn.addEventListener('click', closeGetStartedGuide);
    console.log('Close button event listener added');
  }
  
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      // Find current active tab
      const activeTabIndex = [...tabButtons].findIndex(btn => btn.classList.contains('active'));
      if (activeTabIndex > 0) {
        activateTab(activeTabIndex - 1);
      }
    });
    console.log('Back button event listener added');
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      // Find current active tab
      const activeTabIndex = [...tabButtons].findIndex(btn => btn.classList.contains('active'));
      if (activeTabIndex < tabButtons.length - 1) {
        activateTab(activeTabIndex + 1);
      }
    });
    console.log('Next button event listener added');
  }
  
  if (finishBtn) {
    finishBtn.addEventListener('click', closeGetStartedGuide);
    console.log('Finish button event listener added');
  }
  
  // Set up tab button click events
  tabButtons.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      activateTab(index);
    });
  });
  console.log('Tab button event listeners added');
  
  // Show the guide on first launch if not disabled
  if (shouldShowGuide) {
    // Use a small delay to ensure the app is fully loaded
    console.log('Scheduling Get Started guide to show in 1000ms');
    setTimeout(showGetStartedGuide, 1000);
  }
  
  // Create the help button
  createHelpButton();
}

// Function to create placeholder images for the Get Started guide in the browser
export function createPlaceholderImages() {
  console.log('Creating placeholder images for help sections');
  
  // Find all help images
  const helpImages = document.querySelectorAll('.help-image');
  
  helpImages.forEach(img => {
    // Set an error handler to create a canvas placeholder if the image fails to load
    img.onerror = function() {
      console.log('Creating placeholder for image:', img.alt || 'help image');
      
      // Create a canvas element
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 300;
      canvas.height = img.height || 200;
      
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
      ctx.fillText(img.alt || 'Placeholder Image', canvas.width / 2, canvas.height / 2);
      
      // Replace the image source with the canvas data URL
      img.src = canvas.toDataURL('image/png');
    };
    
    // Force the error handler to run if the src is a non-existent path
    if (img.src.includes('../src/assets/help/')) {
      // Clone the node to force a reload and trigger the error event
      const newImg = img.cloneNode(true);
      newImg.onerror = img.onerror;
      img.parentNode.replaceChild(newImg, img);
    }
  });
}