//Setup Wizard JavaScript implementation
import { getSocket } from './socket.js';

// Single instance of the wizard
let wizardInstance = null;

// Export functions for use in other modules
export async function openSetupWizard(appState) {
  console.log("Opening Setup Wizard");

  try {
    // First, check if we have an existing instance and if it's in a valid state
    let shouldCreateNew = true;
    
    if (wizardInstance) {
      try {
        // Check if the wizard container exists in the DOM
        if (wizardInstance.wizardContainer && 
            document.body.contains(wizardInstance.wizardContainer)) {
          console.log("Reusing existing wizard instance");
          await wizardInstance.open();
          shouldCreateNew = false;
        } else {
          console.flog("Existing wizard instance has invalid container, creating new instance");
          wizardInstance = null;
        }
      } catch (error) {
        console.error("Error with existing wizard instance:", error);
        wizardInstance = null;
      }
    }
    
    if (shouldCreateNew) {
      console.log("Creating new wizard instance");
      wizardInstance = new SetupWizard(appState);
      await wizardInstance.init();
    }

    return wizardInstance;
  } catch (error) {
    console.error("Failed to open setup wizard:", error);
    
    // Create a simple error dialog instead of using alert
    const errorContainer = document.createElement('div');
    errorContainer.style.position = 'fixed';
    errorContainer.style.top = '0';
    errorContainer.style.left = '0';
    errorContainer.style.width = '100%';
    errorContainer.style.height = '100%';
    errorContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    errorContainer.style.zIndex = '1000';
    errorContainer.style.display = 'flex';
    errorContainer.style.justifyContent = 'center';
    errorContainer.style.alignItems = 'center';
    
    errorContainer.innerHTML = `
      <div style="background-color: white; padding: 20px; border-radius: 5px; max-width: 500px;">
        <h2 style="color: #dc3545;">Setup Wizard Error</h2>
        <p>Failed to open setup wizard: ${error.message}</p>
        <button onclick="document.body.removeChild(this.parentNode.parentNode);" 
                style="padding: 8px 16px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 15px;">
          Close
        </button>
      </div>
    `;
    
    document.body.appendChild(errorContainer);
    
    throw error;
  }
}

// Handle ports list from socket messages
export function handlePortsList(ports) {
  console.log("Received ports list:", ports);
  if (wizardInstance) {
    wizardInstance.updatePortsList(ports);
  }
}

class SetupWizard {
  constructor(appState) {
    this.appState = appState || {
      isConnected: false,
      connectedPort: '',
      grblVersion: '',
      settings: {},
      sendCommand: () => console.warn("Mock command sent"),
      addConsoleMessage: () => {}
    };

    window.wizardInstance = this;

    // Set up message handling if not already available
    if (!this.appState.addMessageHandler) {
      this.appState.messageHandlers = [];
      this.appState.addMessageHandler = function(handler) {
        if (typeof handler === 'function') {
          this.messageHandlers.push(handler);
        }
      };
      
      if (!this.appState.removeMessageHandler) {
        this.appState.removeMessageHandler = function(handler) {
          const index = this.messageHandlers.indexOf(handler);
          if (index !== -1) {
            this.messageHandlers.splice(index, 1);
            return true;
          }
          return false;
        };
      }
      
      this.appState.processMessage = function(message) {
        this.messageHandlers.forEach(handler => {
          try {
            handler(message);
          } catch (e) {
            console.error('Error in message handler:', e);
          }
        });
      };
      
      // Hook into the existing addConsoleMessage method if needed
      if (this.appState.addConsoleMessage) {
        const originalAddConsole = this.appState.addConsoleMessage;
        this.appState.addConsoleMessage = function(type, text) {
          // Call original method
          originalAddConsole.call(this, type, text);
          
          // Process message through handlers
          if (text && this.processMessage) {
            this.processMessage(text);
          }
        };
      }
    }

    this.currentStep = 0;
    this.steps = [
      'welcome',
      'import-settings',
      'motor-wiring',
      'step-calibration',
      'limit-switches',
      'homing',
      'soft-limits'
    ];

    this.wizardContainer = null;
    this.elements = {};

    // Default settings values
    this.settings = {
      motorSettings: {
        invertX: false,
        invertY: false,
        invertZ: false
      },
      calibration: {
        stepsX: 0,
        stepsY: 0,
        stepsZ: 0
      },
      limitSwitches: {
        enabled: true,
        inverted: false
      },
      homing: {
        enabled: true,
        directionX: "-X",
        directionY: "-Y",
        directionZ: "-Z"
      },
      softLimits: {
        enabled: true,
        maxTravelX: 200,
        maxTravelY: 200,
        maxTravelZ: 100
      }
    };
  }

  async init() {
    console.log("Initializing wizard");
  
    try {
      // Create the container if it doesn't exist
      let container = document.getElementById('setup-wizard-container');
  
      if (!container) {
        container = document.createElement('div');
        container.id = 'setup-wizard-container';
        container.className = 'setup-wizard';
        container.style.position = 'fixed';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        container.style.zIndex = '1000';
        container.style.display = 'flex';
        container.style.justifyContent = 'center';
        container.style.alignItems = 'center';
  
        document.body.appendChild(container);
      } else {
        container.innerHTML = '';
      }
  
      this.wizardContainer = container;
  
      // Load the HTML first
      try {
        // First try known path from global variable, with fallbacks
        const wizardPath = window.setupWizardPath || 'setup-wizard.html';
        console.log(`Attempting to load wizard HTML from: ${wizardPath}`);
        
        const response = await fetch(wizardPath);
        if (response.ok) {
          const html = await response.text();
          container.innerHTML = html;
          
          // Now after the HTML is loaded, initialize the elements
          console.log("HTML loaded, initializing elements...");
          
          // Use a slightly longer timeout to ensure the DOM is fully processed
          await new Promise(resolve => setTimeout(resolve, 200));
          
          this.initElements();
          
          // Check if we have required elements before proceeding
          if (!this.elements.stepsPanels || this.elements.stepsPanels.length === 0 || 
              !this.elements.stepsItems || this.elements.stepsItems.length === 0) {
            throw new Error("Could not find required wizard elements");
          }
          
          // Continue with initialization - clean up any existing handlers first
          this.cleanupEventListeners();
          
          // If connected to the machine, request fresh settings first
          if (this.appState.isConnected) {
            console.log("Connected to machine, requesting fresh settings");
            this.requestCurrentSettings();
            
            // Give it a moment to receive settings before proceeding
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Now load settings and add new event listeners
          this.loadSettingsFromAppState();
          this.addEventListeners();
          this.updateConnectionStatus();
          this.updateVisibilityBasedOnSettings();
          this.registerPositionHandlers();
          
          // Validate section content to ensure the UI is correct
          this.validateSectionContent();
          
          // Open the wizard (show it)
          this.open();
          
          console.log("Wizard initialization complete");
        } else {
          throw new Error(`Failed to load HTML: ${response.status} - ${response.statusText}`);
        }
      } catch (error) {
        console.error("Error loading HTML:", error);
        container.innerHTML = `
          <div class="wizard-container" style="background-color: white; padding: 20px; border-radius: 5px; max-width: 500px;">
            <h2>Setup Wizard Error</h2>
            <p>Failed to load setup wizard interface: ${error.message}</p>
            <p>Please reload the page and try again.</p>
            <button onclick="document.getElementById('setup-wizard-container').style.display='none';" 
                    style="padding: 8px 16px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
              Close
            </button>
          </div>`;
        throw error;
      }
  
      return this;
    } catch (error) {
      console.error("Error in wizard initialization:", error);
      throw error;
    }
  }

  cleanupEventListeners() {
    // Clean up common buttons that might have event listeners
    const buttons = [
      'backBtn', 'nextBtn', 'finishBtn', 'closeBtn', 'cancelBtn', 'helpBtn', 
      'resetZeroBtn', 'xPlusBtn', 'xMinusBtn', 'yPlusBtn', 'yMinusBtn', 'zPlusBtn', 'zMinusBtn',
      'xUpdateBtn', 'yUpdateBtn', 'zUpdateBtn', 'xSwitchTest', 'ySwitchTest', 'zSwitchTest',
      'testHomingBtn', 'abortHomingBtn', 'homeMachineBtn', 'updateTravelX', 'updateTravelY', 'updateTravelZ'
    ];
    
    buttons.forEach(btnName => {
      const btn = this.elements[btnName];
      if (btn && btn._click_handler) {
        btn.removeEventListener('click', btn._click_handler);
        btn._click_handler = null;
      }
    });
    
    // Clean up checkbox handlers
    const checkboxes = ['invertXCheckbox', 'invertYCheckbox', 'invertZCheckbox', 'enableLimitSwitches', 
                        'invertLimitSwitches', 'enableHoming', 'enableSoftLimits'];
    
    checkboxes.forEach(cbName => {
      const cb = this.elements[cbName];
      if (cb && cb._change_handler) {
        cb.removeEventListener('change', cb._change_handler);
        cb._change_handler = null;
      }
    });
    
    // Clean up select handlers
    const selects = ['xHomingDirection', 'yHomingDirection', 'zHomingDirection', 'stepSize'];
    
    selects.forEach(selectName => {
      const select = this.elements[selectName];
      if (select && select._change_handler) {
        select.removeEventListener('change', select._change_handler);
        select._change_handler = null;
      }
    });
    
    // Clean up input handlers
    const inputs = ['xActualDistance', 'yActualDistance', 'zActualDistance'];
    
    inputs.forEach(inputName => {
      const input = this.elements[inputName];
      if (input && input._input_handler) {
        input.removeEventListener('input', input._input_handler);
        input._input_handler = null;
      }
    });
    
    // Remove any existing message handlers
    if (this.appState.removeMessageHandler && this.limitSwitchHandler) {
      this.appState.removeMessageHandler(this.limitSwitchHandler);
      this.limitSwitchHandler = null;
    }
    
    // Remove position handler
    if (this.appState.removePositionHandler && this.positionUpdateHandler) {
      this.appState.removePositionHandler(this.positionUpdateHandler);
      this.positionUpdateHandler = null;
    }
  }

  // Get references to UI elements
  initElements() {
    try {
      this.elements = {
        // Navigation elements
        stepsPanels: document.querySelectorAll('.step-panel') || [],
        stepsItems: document.querySelectorAll('.steps-list .step') || [],
        backBtn: document.getElementById('back-btn'),
        nextBtn: document.getElementById('next-btn'),
        finishBtn: document.getElementById('finish-btn'),
        closeBtn: document.getElementById('close-wizard'),
        cancelBtn: document.getElementById('cancel-btn'),
        helpBtn: document.getElementById('help-btn'),
        xStepsEstimate: document.getElementById('x-steps-estimate'),
        yStepsEstimate: document.getElementById('y-steps-estimate'),
        zStepsEstimate: document.getElementById('z-steps-estimate'),

      // Connection elements
      connectionStatus: document.getElementById('connection-status-text'),

      // Import settings elements
      openSettingsBtn: document.getElementById('open-settings-file-btn'),
      saveSettingsBtn: document.getElementById('save-settings-file-btn'),

      // Motor wiring elements
      testButtons: document.querySelectorAll('.test-btn[data-axis]'),
      invertXCheckbox: document.getElementById('invert-x'),
      invertYCheckbox: document.getElementById('invert-y'),
      invertZCheckbox: document.getElementById('invert-z'),

      // Step calibration elements
      resetZeroBtn: document.getElementById('reset-to-zero-btn'),
      xPlusBtn: document.getElementById('x-plus-btn'),
      xMinusBtn: document.getElementById('x-minus-btn'),
      yPlusBtn: document.getElementById('y-plus-btn'),
      yMinusBtn: document.getElementById('y-minus-btn'),
      zPlusBtn: document.getElementById('z-plus-btn'),
      zMinusBtn: document.getElementById('z-minus-btn'),
      xDistance: document.getElementById('x-distance'),
      yDistance: document.getElementById('y-distance'),
      zDistance: document.getElementById('z-distance'),
      xActualDistance: document.getElementById('x-actual-distance'),
      yActualDistance: document.getElementById('y-actual-distance'),
      zActualDistance: document.getElementById('z-actual-distance'),
      stepsXInput: document.getElementById('steps-x'),
      stepsYInput: document.getElementById('steps-y'),
      stepsZInput: document.getElementById('steps-z'),
      xUpdateBtn: document.getElementById('x-update-btn'),
      yUpdateBtn: document.getElementById('y-update-btn'),
      zUpdateBtn: document.getElementById('z-update-btn'),

      // Limit switch elements
      enableLimitSwitches: document.getElementById('enable-limit-switches'),
      invertLimitSwitches: document.getElementById('invert-limit-switches'),
      limitSwitchesConfig: document.getElementById('limit-switches-config'),
      xSwitchTest: document.getElementById('x-switch-test'),
      ySwitchTest: document.getElementById('y-switch-test'),
      zSwitchTest: document.getElementById('z-switch-test'),

      // Homing elements
      enableHoming: document.getElementById('enable-homing'),
      homingConfig: document.getElementById('homing-config'),
      xHomingDirection: document.getElementById('x-homing-direction'),
      yHomingDirection: document.getElementById('y-homing-direction'),
      zHomingDirection: document.getElementById('z-homing-direction'),
      testHomingBtn: document.getElementById('test-homing-btn'),
      abortHomingBtn: document.getElementById('abort-homing-btn'),

      // Soft limits elements
      enableSoftLimits: document.getElementById('enable-soft-limits'),
      softLimitsConfig: document.getElementById('soft-limits-config'),
      homeMachineBtn: document.getElementById('home-machine-btn'),
      stepSize: document.getElementById('step-size'),
      maxTravelX: document.getElementById('max-travel-x'),
      maxTravelY: document.getElementById('max-travel-y'),
      maxTravelZ: document.getElementById('max-travel-z'),
      updateTravelX: document.getElementById('update-travel-x'),
      updateTravelY: document.getElementById('update-travel-y'),
      updateTravelZ: document.getElementById('update-travel-z'),
      xPositionDisplay: document.getElementById('x-position-display'),
      yPositionDisplay: document.getElementById('y-position-display'),
      zPositionDisplay: document.getElementById('z-position-display')
    };
    if (this.elements.stepsPanels.length === 0 || this.elements.stepsItems.length === 0) {
      console.error("Required elements not found in the DOM");
    }
  } catch (error) {
    console.error("Error initializing elements:", error);
    throw new Error("Failed to initialize wizard elements");
  }
}

  // Add event listeners to UI elements
  addEventListeners() {
    console.log("Setting up event listeners");
    console.log("Test buttons found:", this.elements.testButtons?.length);
    // Navigation buttons
    if (this.elements.backBtn) {
      this.elements.backBtn.addEventListener('click', () => this.previousStep());
    }

    if (this.elements.nextBtn) {
      this.elements.nextBtn.addEventListener('click', () => this.nextStep());
    }

    if (this.elements.finishBtn) {
      this.elements.finishBtn.addEventListener('click', () => this.finishWizard());
    }

    if (this.elements.closeBtn) {
      this.elements.closeBtn.addEventListener('click', () => this.close());
    }

    if (this.elements.cancelBtn) {
      this.elements.cancelBtn.addEventListener('click', () => this.close());
    }

    if (this.elements.helpBtn) {
      this.elements.helpBtn.addEventListener('click', () => this.showHelp());
    }

    // Step navigation via sidebar
    this.elements.stepsItems.forEach((item, index) => {
      item.addEventListener('click', () => this.goToStep(index));
    });

    // File operations
    if (this.elements.openSettingsBtn) {
      this.elements.openSettingsBtn.addEventListener('click', () => this.openSettingsFile());
    }

    if (this.elements.saveSettingsBtn) {
      this.elements.saveSettingsBtn.addEventListener('click', () => this.saveSettingsToFile());
    }

    // Setup specific listeners for each panel
    this.setupMotorWiringListeners();
    this.setupCalibrationListeners();
    this.setupLimitSwitchListeners();
    this.setupHomingListeners();
    this.setupSoftLimitsListeners();
    this.elements.testButtons?.forEach((btn, index) => {
      console.log(`Test button ${index}:`, {
        axis: btn.getAttribute('data-axis'),
        dir: btn.getAttribute('data-dir'),
        element: btn
      });
    });
  }

  // Open the wizard
  async open() {
    console.log("Opening wizard");
    this.wizardContainer.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
  
    // Start with first step
    this.goToStep(0);
  
    // Update connection status
    this.updateConnectionStatus();
  
    // Validate and fix section content
    this.validateSectionContent();
    
    // Request position updates and fresh settings
    if (this.appState.isConnected) {
      // Request fresh GRBL settings to ensure we have the current values
      this.requestCurrentSettings();
      
      // Wait a bit for settings to load
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Request status update
      this.appState.sendCommand('?', true);
      
      // Request limit switch status if using them
      if (this.settings.limitSwitches.enabled) {
        this.appState.sendCommand('$L', true);
      }
    }
  }
  

  // Close the wizard
  close() {
    console.log("Closing wizard");
    
    // Remove message handlers
    if (this.appState.removeMessageHandler) {
      if (this.limitSwitchHandler) {
        this.appState.removeMessageHandler(this.limitSwitchHandler);
      }
    }
    
    // Remove position handler
    if (this.appState.removePositionHandler && this.positionUpdateHandler) {
      this.appState.removePositionHandler(this.positionUpdateHandler);
    }
    
    this.wizardContainer.style.display = 'none';
    document.body.style.overflow = ''; // Restore scrolling
  }

  // Update connection status
  updateConnectionStatus() {
    if (!this.elements.connectionStatus) return;

    if (this.appState.isConnected) {
      const port = this.appState.connectedPort || "COM5";
      const version = this.appState.grblVersion || "GRBL 1.1h";

      this.elements.connectionStatus.textContent = `Connected to ${version} on ${port}`;
      this.elements.connectionStatus.style.color = '#28a745'; // Green
    } else {
      this.elements.connectionStatus.textContent = 'Not connected';
      this.elements.connectionStatus.style.color = '#dc3545'; // Red
    }
  }

  setupMotorWiringListeners() {
    // Test buttons
    if (this.elements.testButtons) {
      this.elements.testButtons.forEach(btn => {
        // Clear existing handlers
        const oldHandler = btn._click_handler;
        if (oldHandler) {
          btn.removeEventListener('click', oldHandler);
        }
        
        // Add new handler
        const handler = () => {
          const axis = btn.getAttribute('data-axis');
          const dir = parseInt(btn.getAttribute('data-dir'), 10);
          
          if (!axis || isNaN(dir)) {
            console.warn('Invalid button attributes:', { axis, dir });
            return;
          }
          
          console.log(`Moving ${axis} axis by ${dir * 10}mm`);
          // Send command to move the axis
          this.moveAxis(axis, dir * 10);
        };
        
        // Store handler reference
        btn._click_handler = handler;
        
        // Add event listener
        btn.addEventListener('click', handler);
      });
    } else {
      console.warn("Test buttons not found");
    }
  
    // Invert direction checkboxes - add handler cleanup
    const setupInvertCheckbox = (checkbox, property) => {
      if (checkbox) {
        // Remove old handler if it exists
        const oldHandler = checkbox._change_handler;
        if (oldHandler) {
          checkbox.removeEventListener('change', oldHandler);
        }
        
        // Add new handler
        const handler = (e) => {
          this.settings.motorSettings[property] = e.target.checked;
          this.updateDirectionMask();
        };
        
        // Store handler reference
        checkbox._change_handler = handler;
        
        // Add event listener
        checkbox.addEventListener('change', handler);
      }
    };
  
    // Set up each invert checkbox with proper cleanup
    setupInvertCheckbox(this.elements.invertXCheckbox, 'invertX');
    setupInvertCheckbox(this.elements.invertYCheckbox, 'invertY');
    setupInvertCheckbox(this.elements.invertZCheckbox, 'invertZ');
  }

// Update visibility based on settings
updateVisibilityBasedOnSettings() {
  console.log("Updating visibility based on settings:", this.settings);
  
  // Limit switches section
  if (this.elements.limitSwitchesConfig) {
    this.elements.limitSwitchesConfig.style.display = this.settings.limitSwitches.enabled ? 'block' : 'none';
  } else {
    console.warn("Limit switches config element not found");
  }
  
  // Homing section
  if (this.elements.homingConfig) {
    this.elements.homingConfig.style.display = this.settings.homing.enabled ? 'block' : 'none';
  } else {
    console.warn("Homing config element not found");
  }
  
  // Soft limits section
  if (this.elements.softLimitsConfig) {
    this.elements.softLimitsConfig.style.display = this.settings.softLimits.enabled ? 'block' : 'none';
  } else {
    console.warn("Soft limits config element not found");
  }
  
  // Force display update for non-empty content
  ['limit-switches', 'homing', 'soft-limits'].forEach(sectionId => {
    const section = document.getElementById(sectionId);
    if (section) {
      // Make sure the section is visible, not just display: block with no content
      section.style.minHeight = '400px';
      
      // Add placeholder content if section appears empty
      if (section.innerHTML.trim() === '') {
        console.warn(`Section ${sectionId} appears empty, adding placeholder`);
        section.innerHTML = `<h2>${sectionId.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</h2>
        <div class="info-box">
          <i class="fas fa-info-circle"></i>
          <p>This section is currently being loaded...</p>
        </div>`;
      }
    }
  });
}

  // Update ports list if needed
  updatePortsList(ports) {
    console.log("Updating ports list:", ports);
    // Implement if needed for port selection
  }

  // Register position handlers with the main app
  registerPositionHandlers() {
    // Create a position update handler
    this.positionUpdateHandler = (position) => {
      // Update position displays in the soft limits panel
      if (this.elements.xPositionDisplay && position.x !== undefined) 
        this.elements.xPositionDisplay.textContent = `${position.x.toFixed(1)} mm`;
      
      if (this.elements.yPositionDisplay && position.y !== undefined) 
        this.elements.yPositionDisplay.textContent = `${position.y.toFixed(1)} mm`;
      
      if (this.elements.zPositionDisplay && position.z !== undefined) 
        this.elements.zPositionDisplay.textContent = `${position.z.toFixed(1)} mm`;
    };
    
    // Remove any existing handler to prevent duplicates
    if (this.appState.removePositionHandler && this.positionUpdateHandler) {
      this.appState.removePositionHandler(this.positionUpdateHandler);
    }
    
    // Register with app state
    if (this.appState.registerPositionHandler) {
      this.appState.registerPositionHandler(this.positionUpdateHandler);
    }
    // Otherwise, monkey patch the app state's updatePosition method
    else if (this.appState.updatePosition) {
      const originalUpdatePosition = this.appState.updatePosition;
      const handler = this.positionUpdateHandler;
      
      this.appState.updatePosition = function(positions) {
        // Call original method
        originalUpdatePosition.call(this, positions);
        
        // Call our handler if we have work positions
        if (positions.wpos) {
          handler(positions.wpos);
        }
      };
    }
  }
  

  // Load settings from app state
  loadSettingsFromAppState() {
    console.log("Loading settings from app state:", this.appState.settings);
    if (!this.appState.settings) {
      console.warn("No settings found in appState, requesting settings from machine");
      this.requestCurrentSettings();
      return;
    }
  
    // Motor direction
    const dirMask = this.appState.settings.$3 || 0;
    this.settings.motorSettings.invertX = (dirMask & 1) !== 0;
    this.settings.motorSettings.invertY = (dirMask & 2) !== 0;
    this.settings.motorSettings.invertZ = (dirMask & 4) !== 0;
  
    // Calibration - ensure we load the correct values from GRBL
    // Use $100, $101, $102 parameters directly for the most accurate values
    this.settings.calibration.stepsX = parseFloat(this.appState.settings.$100 || this.appState.settings.stepsX || 250);
    this.settings.calibration.stepsY = parseFloat(this.appState.settings.$101 || this.appState.settings.stepsY || 250);
    this.settings.calibration.stepsZ = parseFloat(this.appState.settings.$102 || this.appState.settings.stepsZ || 250);
  
    console.log("Loaded steps/mm values:", {
      stepsX: this.settings.calibration.stepsX,
      stepsY: this.settings.calibration.stepsY,
      stepsZ: this.settings.calibration.stepsZ
    });
  
    // Limit switches
    this.settings.limitSwitches.enabled = this.appState.settings.$21 === 1;
    this.settings.limitSwitches.inverted = this.appState.settings.$5 === 1;
  
    // Homing
    this.settings.homing.enabled = this.appState.settings.$22 === 1;
    const homingMask = this.appState.settings.$23 || 0;
    this.settings.homing.directionX = (homingMask & 1) ? "+X" : "-X";
    this.settings.homing.directionY = (homingMask & 2) ? "+Y" : "-Y";
    this.settings.homing.directionZ = (homingMask & 4) ? "+Z" : "-Z";
  
    // Soft limits
    this.settings.softLimits.enabled = this.appState.settings.$20 === 1;
    this.settings.softLimits.maxTravelX = parseFloat(this.appState.settings.$130 || this.appState.settings.maxTravelX || 200);
    this.settings.softLimits.maxTravelY = parseFloat(this.appState.settings.$131 || this.appState.settings.maxTravelY || 200);
    this.settings.softLimits.maxTravelZ = parseFloat(this.appState.settings.$132 || this.appState.settings.maxTravelZ || 100);
  
    // Update UI with loaded settings
    this.updateUIWithSettings();
    console.log("Settings loaded:", this.settings);
  }


  requestCurrentSettings() {
    if (!this.appState.isConnected) {
      console.warn("Cannot request settings - machine not connected");
      return;
    }
    
    console.log("Requesting current settings from GRBL");
    
    // Create a one-time message handler to process the settings dump
    const settingsHandler = (message) => {
      // Look for GRBL settings format like "$100=250.000"
      if (message.startsWith('$')) {
        try {
          const match = /\$(\d+)=(.+)/.exec(message);
          if (match) {
            const parameter = match[1];
            const value = match[2];
            
            console.log(`Received setting: $${parameter}=${value}`);
            
            // Store in appState settings if it exists
            if (this.appState.settings) {
              this.appState.settings[`$${parameter}`] = parseFloat(value);
              
              // Special handling for steps/mm settings
              if (parameter === '100') {
                this.settings.calibration.stepsX = parseFloat(value);
                this.appState.settings.stepsX = parseFloat(value);
                console.log(`Updated X steps/mm to ${value}`);
              } else if (parameter === '101') {
                this.settings.calibration.stepsY = parseFloat(value);
                this.appState.settings.stepsY = parseFloat(value);
                console.log(`Updated Y steps/mm to ${value}`);
              } else if (parameter === '102') {
                this.settings.calibration.stepsZ = parseFloat(value);
                this.appState.settings.stepsZ = parseFloat(value);
                console.log(`Updated Z steps/mm to ${value}`);
              }
            }
          }
        } catch (error) {
          console.error("Error parsing setting:", error);
        }
      }
      
      // Look for end of settings marker
      if (message.includes('ok')) {
        // Wait a bit to ensure all settings are processed
        setTimeout(() => {
          console.log("Finished loading settings from machine");
          this.updateUIWithSettings();
          
          // Remove this handler after processing
          if (this.appState.removeMessageHandler) {
            this.appState.removeMessageHandler(settingsHandler);
          }
        }, 100);
      }
    };
    
    // Register the handler
    if (this.appState.addMessageHandler) {
      this.appState.addMessageHandler(settingsHandler);
    }
    
    // Send command to get all settings
    this.appState.sendCommand('$$');
  }

  // Update UI elements with current settings
updateUIWithSettings() {
  console.log("Updating UI with current settings:", {
    stepsX: this.settings.calibration.stepsX,
    stepsY: this.settings.calibration.stepsY,
    stepsZ: this.settings.calibration.stepsZ
  });
  
  // Motor direction
  if (this.elements.invertXCheckbox) {
    this.elements.invertXCheckbox.checked = this.settings.motorSettings.invertX;
  }

  if (this.elements.invertYCheckbox) {
    this.elements.invertYCheckbox.checked = this.settings.motorSettings.invertY;
  }

  if (this.elements.invertZCheckbox) {
    this.elements.invertZCheckbox.checked = this.settings.motorSettings.invertZ;
  }

  // Calibration - ensure proper display of steps/mm values
  const updateStepsDisplay = (axis, value) => {
    const input = this.elements[`steps${axis}Input`];
    const estimateElement = document.getElementById(`${axis.toLowerCase()}-steps-estimate`);
    
    if (input) {
      // Format the value with 3 decimal places for consistent display
      const formattedValue = parseFloat(value).toFixed(3);
      
      // Set the input value to the current calibration value
      input.value = formattedValue;
      
      // Update the estimate text to show current value
      if (estimateElement) {
        estimateElement.textContent = `${formattedValue} steps/mm est.`;
        estimateElement.style.color = '#3498db'; // Ensure blue color
        
        // Log to confirm values are being updated correctly
        console.log(`Updated ${axis} steps display to ${formattedValue} steps/mm`);
      }
    }
  };
  
  updateStepsDisplay('X', this.settings.calibration.stepsX);
  updateStepsDisplay('Y', this.settings.calibration.stepsY);
  updateStepsDisplay('Z', this.settings.calibration.stepsZ);

  
    // Limit switches
    if (this.elements.enableLimitSwitches) {
      this.elements.enableLimitSwitches.checked = this.settings.limitSwitches.enabled;
    }
  
    if (this.elements.invertLimitSwitches) {
      this.elements.invertLimitSwitches.checked = this.settings.limitSwitches.inverted;
    }
  
    // Homing
    if (this.elements.enableHoming) {
      this.elements.enableHoming.checked = this.settings.homing.enabled;
    }
  
    if (this.elements.xHomingDirection) {
      this.elements.xHomingDirection.value = this.settings.homing.directionX;
    }
  
    if (this.elements.yHomingDirection) {
      this.elements.yHomingDirection.value = this.settings.homing.directionY;
    }
  
    if (this.elements.zHomingDirection) {
      this.elements.zHomingDirection.value = this.settings.homing.directionZ;
    }
  
    // Soft limits
    if (this.elements.enableSoftLimits) {
      this.elements.enableSoftLimits.checked = this.settings.softLimits.enabled;
    }
  
    if (this.elements.maxTravelX) {
      this.elements.maxTravelX.value = this.settings.softLimits.maxTravelX;
    }
  
    if (this.elements.maxTravelY) {
      this.elements.maxTravelY.value = this.settings.softLimits.maxTravelY;
    }
  
    if (this.elements.maxTravelZ) {
      this.elements.maxTravelZ.value = this.settings.softLimits.maxTravelZ;
    }
  
    // Update visibility based on settings
    this.updateVisibilityBasedOnSettings();
  }
  
  calculateAndUpdateEstimate(axis, commandedDistance) {
    // Get required elements
    const actualDistanceElement = this.elements[`${axis.toLowerCase()}ActualDistance`];
    const stepsInputElement = this.elements[`steps${axis}Input`];
    // More reliably find the estimate element by ID
    const estimateElement = document.getElementById(`${axis.toLowerCase()}-steps-estimate`);
    
    if (!actualDistanceElement || !stepsInputElement || !estimateElement) {
      console.error(`Missing elements for ${axis} calibration calculation`, {
        actualDistanceElement: !!actualDistanceElement,
        stepsInputElement: !!stepsInputElement,
        estimateElement: !!estimateElement
      });
      return;
    }
    
    // Get the actual distance from user input
    const actualDistance = parseFloat(actualDistanceElement.value);
    // Get current steps from settings (not from the input field)
    const currentSteps = this.settings.calibration[`steps${axis}`];
    
    console.log(`Calibration calculation for ${axis}:`, {
      currentSteps,
      commandedDistance,
      actualDistance
    });
    
    // Validate input to prevent calculation errors
    if (isNaN(actualDistance) || isNaN(currentSteps) || 
        Math.abs(actualDistance) < 0.001 || Math.abs(commandedDistance) < 0.001) {
      console.warn(`Invalid values for ${axis} calibration calculation`);
      estimateElement.textContent = "0.000 steps/mm est.";
      return;
    }
    
    // Calculate the new steps/mm value
    // Formula: New steps/mm = (Current steps/mm × Commanded distance) / Actual distance
    const estimatedSteps = (currentSteps * Math.abs(commandedDistance)) / Math.abs(actualDistance);
    
    // Update the UI with formatted value
    const formattedEstimate = estimatedSteps.toFixed(3);
    estimateElement.textContent = `${formattedEstimate} steps/mm est.`;
    estimateElement.style.color = '#3498db'; // Highlight in blue
    
    console.log(`${axis} calibration result: ${formattedEstimate} steps/mm`);
    
    return estimatedSteps;
  }

  setupCalibrationListeners() {
    // Track current distances - make this an instance property
    this.axisDistances = { X: 0, Y: 0, Z: 0 };
  
    // Reset to zero button
    this.elements.resetZeroBtn?.addEventListener('click', () => {
      if (!this.appState.isConnected) {
        this.appState.addConsoleMessage('system', 'Machine not connected. Please connect to proceed with calibration.');
        return;
      }
  
      // Reset position to zero
      this.appState.sendCommand('G10 P0 L20 X0 Y0 Z0');
      this.appState.addConsoleMessage('system', 'Reset machine position to zero');
  
      // Reset distance trackers
      this.axisDistances.X = 0;
      this.axisDistances.Y = 0;
      this.axisDistances.Z = 0;
  
      // Update displays
      if (this.elements.xDistance) this.elements.xDistance.textContent = '0.0 mm';
      if (this.elements.yDistance) this.elements.yDistance.textContent = '0.0 mm';
      if (this.elements.zDistance) this.elements.zDistance.textContent = '0.0 mm';
      
    });
  
    // Axis movement buttons with distance tracking
    const moveAndUpdateDistance = (axis, distance) => {
      if (!this.appState.isConnected) {
        this.appState.addConsoleMessage('system', 'Machine not connected. Please connect to proceed with calibration.');
        return;
      }
      
      this.moveAxis(axis, distance);
      // Use the instance property instead of local variable
      this.axisDistances[axis] += distance;
  
      // Update display
      const displayElement = this.elements[`${axis.toLowerCase()}Distance`];
      if (displayElement) {
        displayElement.textContent = `${this.axisDistances[axis].toFixed(1)} mm`;
      }
      
      // After movement, recalculate the estimate if we have an actual distance value
      const actualDistanceInput = this.elements[`${axis.toLowerCase()}ActualDistance`];
      if (actualDistanceInput && actualDistanceInput.value) {
        // Call the instance method with the current total distance
        this.calculateAndUpdateEstimate(axis, this.axisDistances[axis]);
      }
    };
  
    // Set up movement buttons
    this.elements.xPlusBtn?.addEventListener('click', () => moveAndUpdateDistance('X', 10));
    this.elements.xMinusBtn?.addEventListener('click', () => moveAndUpdateDistance('X', -10));
    this.elements.yPlusBtn?.addEventListener('click', () => moveAndUpdateDistance('Y', 10));
    this.elements.yMinusBtn?.addEventListener('click', () => moveAndUpdateDistance('Y', -10));
    this.elements.zPlusBtn?.addEventListener('click', () => moveAndUpdateDistance('Z', 10));
    this.elements.zMinusBtn?.addEventListener('click', () => moveAndUpdateDistance('Z', -10));
  
    // Add input event listeners for actual distance fields
    ['X', 'Y', 'Z'].forEach(axis => {
      const actualDistanceInput = this.elements[`${axis.toLowerCase()}ActualDistance`];
      if (actualDistanceInput) {
        // Remove any existing handlers to prevent duplicates
        const oldHandler = actualDistanceInput._input_handler;
        if (oldHandler) {
          actualDistanceInput.removeEventListener('input', oldHandler);
        }
        
        // Add new handler with direct reference to the current commanded distance
        const handler = () => {
          // Get current commanded distance from the element
          const distanceElement = this.elements[`${axis.toLowerCase()}Distance`];
          const commandedDistanceText = distanceElement?.textContent || '0.0 mm';
          const commandedDistance = parseFloat(commandedDistanceText.replace(' mm', '')) || 0;
          
          // Call the instance method directly with current distance
          this.calculateAndUpdateEstimate(axis, commandedDistance);
        };
        
        // Store the handler for future removal
        actualDistanceInput._input_handler = handler;
        
        // Use the input event to update in real-time
        actualDistanceInput.addEventListener('input', handler);
      }
    });
  
    // Set up update buttons - IMPORTANT: Using arrow functions to maintain 'this' context
    const setupUpdateButton = (axis) => {
      const button = this.elements[`${axis.toLowerCase()}UpdateBtn`];
      if (button) {
        // Remove any existing handlers to prevent duplicates
        const oldHandler = button._click_handler;
        if (oldHandler) {
          button.removeEventListener('click', oldHandler);
        }
  
        // Add new handler
        const handler = () => this.updateCalibration(axis);
  
        // Store the handler for future removal
        button._click_handler = handler;
  
        // Add event listener
        button.addEventListener('click', handler);
      }
    };
  
    setupUpdateButton('X');
    setupUpdateButton('Y');
    setupUpdateButton('Z');
  }

  updateCalibration(axis) {
    console.log(`=== Starting updateCalibration for ${axis} axis ===`);
  
    // Check connection
    if (!this.appState.isConnected) {
      this.appState.addConsoleMessage('system', 'Machine not connected. Please connect to proceed with calibration.');
      return;
    }
  
    // Option 1: Use the current estimate from the DOM if available
    const estimateElement = document.getElementById(`${axis.toLowerCase()}-steps-estimate`);
    let newSteps;
    
    if (estimateElement && estimateElement.textContent) {
      // Extract the numeric value from the estimate text
      const match = /(\d+\.\d+)/.exec(estimateElement.textContent);
      if (match && match[1]) {
        newSteps = parseFloat(match[1]);
        console.log(`Using calculated estimate from UI: ${newSteps}`);
      }
    }
    
    // Option 2: Fall back to the input field if no valid estimate is available
    if (!newSteps) {
      const inputField = this.elements[`steps${axis}Input`];
      if (!inputField) {
        console.error(`Input field for ${axis} axis not found`);
        return;
      }
      
      // Get the exact string value from the input
      const inputValue = inputField.value.trim();
      console.log(`Using input field value: "${inputValue}"`);
      
      // Parse to a number
      newSteps = parseFloat(inputValue);
    }
    
    console.log(`Final parsed value: ${newSteps}`);
  
    // Validate the parsed value
    if (isNaN(newSteps) || newSteps <= 0) {
      this.appState.addConsoleMessage('error', `Invalid steps value for ${axis} axis. Please enter a positive number.`);
      return;
    }
  
    // Format the value with exactly 3 decimal places for GRBL
    const formattedValue = newSteps.toFixed(3);
    console.log(`Formatted value: ${formattedValue}`);
  
    // Determine parameter number for GRBL
    const paramNumber = axis === 'X' ? 100 : (axis === 'Y' ? 101 : 102);
  
    // Create the exact command string
    const command = `$${paramNumber}=${formattedValue}`;
  
    console.log(`Command to send: ${command}`);
  
    // Send the command directly with the formatted value
    this.appState.sendCommand(command);
  
    // Update local settings
    this.settings.calibration[`steps${axis}`] = newSteps;
  
    // Update app state settings
    if (this.appState.settings) {
      this.appState.settings[`$${paramNumber}`] = newSteps;
      this.appState.settings[`steps${axis}`] = newSteps;
    }
    
    // Update the input field to match the new value
    const inputField = this.elements[`steps${axis}Input`];
    if (inputField) {
      inputField.value = formattedValue;
    }
  
    // Log success message
    this.appState.addConsoleMessage('system', `Updated ${axis}-axis calibration to ${formattedValue} steps/mm`);
  
    // Visual feedback
    const button = this.elements[`${axis.toLowerCase()}UpdateBtn`];
    if (button) {
      const originalBg = button.style.backgroundColor || '';
      const originalText = button.textContent || 'Update';
  
      button.style.backgroundColor = '#28a745'; // Green for success
      button.textContent = 'Updated!';
  
      // Reset button style after a short delay
      setTimeout(() => {
        button.style.backgroundColor = originalBg;
        button.textContent = originalText;
      }, 1000);
    }
  
    console.log(`=== Completed updateCalibration for ${axis} axis ===`);
  }
  
  // Update addEventListeners to add dependencies between checkboxes
  setupLimitSwitchListeners() {
    // Enable limit switches
    this.elements.enableLimitSwitches?.addEventListener('change', (e) => {
      this.settings.limitSwitches.enabled = e.target.checked;
      
      // Toggle visibility of the limit switch configuration section
      if (this.elements.limitSwitchesConfig) {
        this.elements.limitSwitchesConfig.style.display = e.target.checked ? 'block' : 'none';
      }
      
      // Disable homing and soft limits if limit switches are disabled
      if (!e.target.checked) {
        if (this.elements.enableHoming) {
          this.elements.enableHoming.checked = false;
          this.elements.enableHoming.disabled = true;
          this.settings.homing.enabled = false;
          if (this.elements.homingConfig) {
            this.elements.homingConfig.style.display = 'none';
          }
        }
        
        if (this.elements.enableSoftLimits) {
          this.elements.enableSoftLimits.checked = false;
          this.elements.enableSoftLimits.disabled = true;
          this.settings.softLimits.enabled = false;
          if (this.elements.softLimitsConfig) {
            this.elements.softLimitsConfig.style.display = 'none';
          }
        }
      } else {
        // Re-enable the checkboxes if limit switches are enabled
        if (this.elements.enableHoming) {
          this.elements.enableHoming.disabled = false;
        }
        
        if (this.elements.enableSoftLimits) {
          this.elements.enableSoftLimits.disabled = false;
        }
      }
      
      if (this.appState.isConnected) {
        this.appState.sendCommand(`$21=${e.target.checked ? 1 : 0}`);
      }
    });
  
    // Invert limit switches
    this.elements.invertLimitSwitches?.addEventListener('change', (e) => {
      this.settings.limitSwitches.inverted = e.target.checked;
      if (this.appState.isConnected) {
        this.appState.sendCommand(`$5=${e.target.checked ? 1 : 0}`);
      }
    });
  
    // Setup status indicators - make sure we can find them
    const xStatusElement = document.querySelector('#x-switch-test + .switch-status');
    const yStatusElement = document.querySelector('#y-switch-test + .switch-status');
    const zStatusElement = document.querySelector('#z-switch-test + .switch-status');
  
    // Function to update switch display based on state - more reliable
    const updateSwitchStatus = (axis, active) => {
      const button = this.elements[`${axis.toLowerCase()}SwitchTest`];
      let statusElement;
      
      switch(axis.toLowerCase()) {
        case 'x': statusElement = xStatusElement; break;
        case 'y': statusElement = yStatusElement; break;
        case 'z': statusElement = zStatusElement; break;
      }
      
      if (!button) {
        console.warn(`Button for ${axis} switch test not found`);
        return;
      }
  
      if (active) {
        button.classList.add('active');
        button.style.backgroundColor = '#28a745'; // Green when active
        if (statusElement) {
          statusElement.textContent = 'Triggered';
          statusElement.classList.add('triggered');
        }
      } else {
        button.classList.remove('active');
        button.style.backgroundColor = ''; // Default color when inactive
        if (statusElement) {
          statusElement.textContent = 'Not triggered';
          statusElement.classList.remove('triggered');
        }
      }
    };
  
    // Improved limit switch message handler with better parsing
    const limitSwitchHandler = (message) => {
      // Handle our custom message format
      if (message.startsWith('LIMIT:')) {
        const parts = message.substring(6).split(',');
        
        // Format is LIMIT:X,Y,Z where 1=triggered, 0=not triggered
        if (parts.length >= 3) {
          updateSwitchStatus('x', parts[0] === '1');
          updateSwitchStatus('y', parts[1] === '1');
          updateSwitchStatus('z', parts[2] === '1');
        }
        return;
      }
      
      // Handle direct GRBL limit switch responses with better regex
      if (message.includes('Limit:')) {
        try {
          // Parse the limit switch status from GRBL format
          const match = /\[Limit:([^\]]+)\]/.exec(message);
          if (match && match[1]) {
            const states = match[1].split(',').map(s => s.trim() === '1');
            
            // Update switch display
            if (states.length >= 3) {
              updateSwitchStatus('x', states[0]);
              updateSwitchStatus('y', states[1]); 
              updateSwitchStatus('z', states[2]);
            }
          }
        } catch (e) {
          console.error('Error parsing limit switch status:', e);
        }
      }
    };
  
    // Store handler reference so we can remove it later
    this.limitSwitchHandler = limitSwitchHandler;
    
    // Remove any existing handler to prevent duplicates
    if (this.appState.removeMessageHandler) {
      this.appState.removeMessageHandler(this.limitSwitchHandler);
    }
    
    // Add handler to appState
    if (this.appState.addMessageHandler) {
      this.appState.addMessageHandler(this.limitSwitchHandler);
    }
  
    // Test buttons - when clicked, query the limit switch status
    const setupSwitchTestButton = (axis, button) => {
      if (!button) return;
  
      // Remove any existing event listeners to prevent duplicates
      const oldHandler = button._click_handler;
      if (oldHandler) {
        button.removeEventListener('click', oldHandler);
      }
  
      // Add new handler
      const handler = () => {
        if (this.appState.isConnected) {
          // Send command to query limit switch state
          this.appState.sendCommand('$L', true);
          this.appState.addConsoleMessage('system', `Querying ${axis} limit switch status`);
        } else {
          alert('Machine not connected. Cannot test limit switches.');
        }
      };
  
      // Store the handler for future removal
      button._click_handler = handler;
      
      button.addEventListener('click', handler);
    };
  
    // Setup test buttons with improved handlers
    setupSwitchTestButton('x', this.elements.xSwitchTest);
    setupSwitchTestButton('y', this.elements.ySwitchTest);
    setupSwitchTestButton('z', this.elements.zSwitchTest);
  }

  // Add this method to diagnose and fix content issues
validateSectionContent() {
  const sections = ['limit-switches', 'homing', 'soft-limits'];
  let hasErrors = false;
  
  sections.forEach(sectionId => {
    const section = document.getElementById(sectionId);
    if (!section) {
      console.error(`Section #${sectionId} not found in the DOM`);
      hasErrors = true;
      return;
    }
    
    // Check for expected child elements
    const configSection = section.querySelector(`#${sectionId.replace('-', '-')}-config`);
    if (!configSection) {
      console.error(`Config section #${sectionId.replace('-', '-')}-config not found`);
      hasErrors = true;
      
      // Try to fix by adding the required container
      const configDiv = document.createElement('div');
      configDiv.id = `${sectionId.replace('-', '-')}-config`;
      configDiv.style.display = this.settings[sectionId.replace('-', '')] ? 'block' : 'none';
      section.appendChild(configDiv);
      
      // Add some default content
      if (sectionId === 'limit-switches') {
        configDiv.innerHTML = `
          <p>Try triggering each limit switch manually. The button will turn green when a switch is activated.</p>
          <div class="switch-test-grid">
            <div class="switch-test-container">
              <button class="btn-primary" id="x-switch-test">X</button>
              <span class="switch-status">Not triggered</span>
            </div>
            <div class="switch-test-container">
              <button class="btn-primary" id="y-switch-test">Y</button>
              <span class="switch-status">Not triggered</span>
            </div>
            <div class="switch-test-container">
              <button class="btn-primary" id="z-switch-test">Z</button>
              <span class="switch-status">Not triggered</span>
            </div>
          </div>
          <div class="switch-config">
            <input type="checkbox" id="invert-limit-switches">
            <label for="invert-limit-switches">Invert limit switches</label>
          </div>
        `;
      }
    }
  });
  
  if (hasErrors) {
    console.warn("Content validation found issues and attempted to fix them");
    // Re-initialize elements after fixing
    this.initElements();
    this.addEventListeners();
  }
  
  return !hasErrors;
}
  // Setup listeners for homing step
  setupHomingListeners() {
    // Enable homing checkbox
    this.elements.enableHoming?.addEventListener('change', (e) => {
      this.settings.homing.enabled = e.target.checked;
      
      // Toggle visibility of the homing configuration section
      if (this.elements.homingConfig) {
        this.elements.homingConfig.style.display = e.target.checked ? 'block' : 'none';
      }
      
      // Disable soft limits if homing is disabled
      if (!e.target.checked && this.elements.enableSoftLimits) {
        this.elements.enableSoftLimits.checked = false;
        this.elements.enableSoftLimits.disabled = true;
        this.settings.softLimits.enabled = false;
        if (this.elements.softLimitsConfig) {
          this.elements.softLimitsConfig.style.display = 'none';
        }
      } else if (e.target.checked && this.elements.enableSoftLimits) {
        this.elements.enableSoftLimits.disabled = false;
      }
      
      if (this.appState.isConnected) {
        this.appState.sendCommand(`$22=${e.target.checked ? 1 : 0}`);
        this.appState.addConsoleMessage('system', `${e.target.checked ? 'Enabled' : 'Disabled'} homing cycle`);
      }
    });
  
    // Direction selection for each axis
    const setupHomingDirectionSelect = (axis, element) => {
      if (!element) return;
      
      element.addEventListener('change', (e) => {
        this.settings.homing[`direction${axis}`] = e.target.value;
        this.updateHomingMask();
        
        if (this.appState.isConnected) {
          this.appState.addConsoleMessage('system', `Set ${axis}-axis homing direction to ${e.target.value}`);
        }
      });
    };
  
    setupHomingDirectionSelect('X', this.elements.xHomingDirection);
    setupHomingDirectionSelect('Y', this.elements.yHomingDirection);
    setupHomingDirectionSelect('Z', this.elements.zHomingDirection);
  
    // Test homing button
    if (this.elements.testHomingBtn) {
      // Remove existing handlers to prevent duplicates
      const oldHandler = this.elements.testHomingBtn._click_handler;
      if (oldHandler) {
        this.elements.testHomingBtn.removeEventListener('click', oldHandler);
      }
      
      // Add new handler
      const handler = () => {
        if (!this.appState.isConnected) {
          alert('Machine not connected. Cannot test homing.');
          return;
        }
        
        if (confirm('The machine will now perform a homing cycle. Make sure the area is clear. Continue?')) {
          this.appState.sendCommand('$H');
          this.appState.addConsoleMessage('system', 'Performing homing cycle - stand by...');
        }
      };
      
      // Store the handler for future removal
      this.elements.testHomingBtn._click_handler = handler;
      
      this.elements.testHomingBtn.addEventListener('click', handler);
    }
  
    // Abort homing button
    if (this.elements.abortHomingBtn) {
      // Remove existing handlers to prevent duplicates
      const oldHandler = this.elements.abortHomingBtn._click_handler;
      if (oldHandler) {
        this.elements.abortHomingBtn.removeEventListener('click', oldHandler);
      }
      
      // Add new handler
      const handler = () => {
        if (!this.appState.isConnected) return;
  
        // Send feed hold and reset
        this.appState.sendCommand('!', true); // Feed hold with priority flag
        setTimeout(() => {
          this.appState.sendCommand('\x18', true); // Reset with priority flag
          this.appState.addConsoleMessage('system', 'Homing cycle aborted');
        }, 100);
      };
      
      // Store the handler for future removal
      this.elements.abortHomingBtn._click_handler = handler;
      
      this.elements.abortHomingBtn.addEventListener('click', handler);
    }
  }

  // Setup listeners for soft limits step
  setupSoftLimitsListeners() {
    // Enable soft limits
    if (this.elements.enableSoftLimits) {
      // Remove any existing handler
      const oldHandler = this.elements.enableSoftLimits._change_handler;
      if (oldHandler) {
        this.elements.enableSoftLimits.removeEventListener('change', oldHandler);
      }
      
      // Add new handler
      const handler = (e) => {
        this.settings.softLimits.enabled = e.target.checked;
        
        // Toggle visibility of the soft limits configuration section
        if (this.elements.softLimitsConfig) {
          this.elements.softLimitsConfig.style.display = e.target.checked ? 'block' : 'none';
        }
        
        if (this.appState.isConnected) {
          this.appState.sendCommand(`$20=${e.target.checked ? 1 : 0}`);
          this.appState.addConsoleMessage('system', `${e.target.checked ? 'Enabled' : 'Disabled'} soft limits`);
        }
      };
      
      // Store the handler for future removal
      this.elements.enableSoftLimits._change_handler = handler;
      
      this.elements.enableSoftLimits.addEventListener('change', handler);
    }
  
    // Home machine button
    if (this.elements.homeMachineBtn) {
      // Remove existing handler
      const oldHandler = this.elements.homeMachineBtn._click_handler;
      if (oldHandler) {
        this.elements.homeMachineBtn.removeEventListener('click', oldHandler);
      }
      
      // Add new handler
      const handler = () => {
        if (this.appState.isConnected) {
          if (confirm('The machine will now perform a homing cycle. Make sure the area is clear. Continue?')) {
            this.appState.sendCommand('$H');
            this.appState.addConsoleMessage('system', 'Performing homing cycle');
          }
        } else {
          alert('Machine not connected. Please connect to perform homing.');
        }
      };
      
      // Store the handler for future removal
      this.elements.homeMachineBtn._click_handler = handler;
      
      this.elements.homeMachineBtn.addEventListener('click', handler);
    }
  
    // Step size selection
    if (this.elements.stepSize) {
      // Remove existing handler
      const oldHandler = this.elements.stepSize._change_handler;
      if (oldHandler) {
        this.elements.stepSize.removeEventListener('change', oldHandler);
      }
      
      // New handler is not needed as we'll read the value directly when needed
    }
  
    // Max travel updates with proper validation
    const setupTravelButton = (axis, inputElement, buttonElement) => {
      if (!buttonElement || !inputElement) return;
      
      // Remove existing handler
      const oldHandler = buttonElement._click_handler;
      if (oldHandler) {
        buttonElement.removeEventListener('click', oldHandler);
      }
      
      // Add new handler
      const handler = () => {
        const value = parseFloat(inputElement.value);
        if (isNaN(value) || value <= 0) {
          alert('Please enter a valid positive number for the travel distance');
          return;
        }
  
        this.settings.softLimits[`maxTravel${axis}`] = value;
  
        if (this.appState.isConnected) {
          const paramNumber = axis === 'X' ? 130 : (axis === 'Y' ? 131 : 132);
          this.appState.sendCommand(`${paramNumber}=${value}`);
          this.appState.addConsoleMessage('system', `Updated ${axis}-axis max travel to ${value}mm`);
          
          // Update the appState settings for the main application
          if (this.appState.settings) {
            this.appState.settings[`${paramNumber}`] = value;
            this.appState.settings[`maxTravel${axis}`] = value;
          }
        }
        
        alert(`${axis}-axis maximum travel updated to ${value}mm`);
      };
      
      // Store the handler for future removal
      buttonElement._click_handler = handler;
      
      buttonElement.addEventListener('click', handler);
    };
  
    setupTravelButton('X', this.elements.maxTravelX, this.elements.updateTravelX);
    setupTravelButton('Y', this.elements.maxTravelY, this.elements.updateTravelY);
    setupTravelButton('Z', this.elements.maxTravelZ, this.elements.updateTravelZ);
  
    // Movement buttons in soft limits panel
    const setupMovementButton = (axis, direction, buttonId) => {
      const button = document.getElementById(buttonId);
      if (!button) return;
      
      // Remove existing handler
      const oldHandler = button._click_handler;
      if (oldHandler) {
        button.removeEventListener('click', oldHandler);
      }
      
      // Add new handler
      const handler = () => {
        if (!this.appState.isConnected) {
          alert('Machine not connected');
          return;
        }
        
        const stepSize = parseFloat(this.elements.stepSize?.value || 10);
        this.moveAxis(axis, direction * stepSize);
      };
      
      // Store the handler for future removal
      button._click_handler = handler;
      
      button.addEventListener('click', handler);
    };
  
    setupMovementButton('X', -1, 'x-minus-move');
    setupMovementButton('X', 1, 'x-plus-move');
    setupMovementButton('Y', -1, 'y-minus-move');
    setupMovementButton('Y', 1, 'y-plus-move');
    setupMovementButton('Z', -1, 'z-minus-move');
    setupMovementButton('Z', 1, 'z-plus-move');
  }
  

  // Open settings file from the file system
  openSettingsFile() {
    // Create a file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    
    // Add event listener for file selection
    fileInput.addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (file) {
        try {
          await this.loadSettingsFromFile(file);
          alert('Settings loaded successfully!');
        } catch (error) {
          alert(`Failed to load settings: ${error.message}`);
        }
      }
      
      // Clean up
      document.body.removeChild(fileInput);
    });
    
    // Add to body and trigger click
    document.body.appendChild(fileInput);
    fileInput.click();
  }

  // Load settings from a file
  loadSettingsFromFile(file) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        
        reader.onload = (event) => {
          try {
            const settingsJson = event.target.result;
            const loadedSettings = JSON.parse(settingsJson);
            
            // Validate the settings format
            if (!loadedSettings.settings) {
              throw new Error("Invalid settings file format");
            }
            
            // Update our settings object
            this.settings = loadedSettings.settings;
            
            // Update UI with loaded settings
            this.updateUIWithSettings();
            
            // Update visibility based on new settings
            this.updateVisibilityBasedOnSettings();
            
            // Apply to machine if connected
            if (this.appState.isConnected) {
              this.applySettingsToMachine(loadedSettings.grblParams);
            }
            
            resolve(true);
          } catch (error) {
            console.error("Error parsing settings file:", error);
            reject(error);
          }
        };
        
        reader.onerror = (error) => {
          console.error("Error reading file:", error);
          reject(error);
        };
        
        reader.readAsText(file);
      } catch (error) {
        console.error("Error loading settings file:", error);
        reject(error);
      }
    });
  }

  // Apply GRBL parameters to the machine
  applySettingsToMachine(params) {
    if (!this.appState.isConnected) {
      alert('Machine not connected');
      return false;
    }
    
    try {
      // Apply each parameter one by one
      Object.entries(params).forEach(([param, value]) => {
        this.appState.sendCommand(`${param}=${value}`);
      });
      
      return true;
    } catch (error) {
      console.error("Error applying settings to machine:", error);
      alert(`Failed to apply settings: ${error.message}`);
      return false;
    }
  }

  // Save settings to a file
  saveSettingsToFile() {
    try {
      // Create a settings object with all the current configurations
      const settingsToSave = {
        version: 1, // Version for future compatibility
        date: new Date().toISOString(),
        machine: {
          name: "CNC Machine", // Could be customizable
          grblVersion: this.appState.grblVersion || "Unknown"
        },
        settings: this.settings,
        // Add raw GRBL parameters for direct loading
        grblParams: this.convertSettingsToGrblParams()
      };
      
      // Convert to JSON
      const settingsJson = JSON.stringify(settingsToSave, null, 2);
      
      // Create a Blob with the JSON content
      const blob = new Blob([settingsJson], { type: 'application/json' });
      
      // Create a download link and trigger the download
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cnc-machine-settings.json';
      
      // Append to body, click and remove
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up the URL object
      URL.revokeObjectURL(a.href);
      
      return true;
    } catch (error) {
      console.error("Error saving settings to file:", error);
      alert(`Failed to save settings: ${error.message}`);
      return false;
    }
  }

  // Convert settings object to GRBL parameter format
  convertSettingsToGrblParams() {
    const params = {};
    
    // Direction mask
    params.$3 = this.calculateDirectionMask();
    
    // Limit switch inversion
    params.$5 = this.settings.limitSwitches.inverted ? 1 : 0;
    
    // Soft limits
    params.$20 = this.settings.softLimits.enabled ? 1 : 0;
    
    // Hard limits
    params.$21 = this.settings.limitSwitches.enabled ? 1 : 0;
    
    // Homing cycle
    params.$22 = this.settings.homing.enabled ? 1 : 0;
    
    // Homing direction mask
    params.$23 = this.calculateHomingMask();
    
    // Steps per mm
    params.$100 = this.settings.calibration.stepsX;
    params.$101 = this.settings.calibration.stepsY;
    params.$102 = this.settings.calibration.stepsZ;
    
    // Max travel
    params.$130 = this.settings.softLimits.maxTravelX;
    params.$131 = this.settings.softLimits.maxTravelY;
    params.$132 = this.settings.softLimits.maxTravelZ;
    
    return params;
  }

  // Move an axis by sending GCODE commands
  moveAxis(axis, distance) {
    if (!this.appState.isConnected) {
      alert('Machine not connected');
      return;
    }
  
    try {
      console.log(`Sending command to move ${axis} by ${distance}mm`);
      
      // Log the current state for debugging
      console.log("Connection state:", {
        isConnected: this.appState.isConnected,
        serialPort: this.appState.serialPort ? "exists" : "missing"
      });
      
      // Using G91 for relative motion - add small delays to ensure commands are processed in order
      this.appState.sendCommand('G91', true); // Relative positioning
      
      // Simple pause to ensure commands are processed in sequence
      setTimeout(() => {
        this.appState.sendCommand(`G1 ${axis}${distance} F500`, true); // Move at 500mm/min
        
        // Another short delay before returning to absolute mode
        setTimeout(() => {
          this.appState.sendCommand('G90', true); // Back to absolute positioning
          this.appState.addConsoleMessage('system', `Moving ${axis} axis ${distance > 0 ? '+' : ''}${distance}mm`);
        }, 50);
      }, 50);
    } catch (error) {
      console.error(`Error moving axis ${axis}:`, error);
      this.appState.addConsoleMessage('error', `Error moving ${axis} axis: ${error.message}`);
    }
  }
  // Update the direction mask
  updateDirectionMask() {
    let mask = 0;
    if (this.settings.motorSettings.invertX) mask |= 1;
    if (this.settings.motorSettings.invertY) mask |= 2;
    if (this.settings.motorSettings.invertZ) mask |= 4;

    if (this.appState.isConnected) {
      this.appState.sendCommand(`$3=${mask}`);
    }
  }

  // Update the homing direction mask
  updateHomingMask() {
    let mask = 0;
    if (this.settings.homing.directionX === "+X") mask |= 1;
    if (this.settings.homing.directionY === "+Y") mask |= 2;
    if (this.settings.homing.directionZ === "+Z") mask |= 4;
  
    console.log("Updating homing mask:", {
      directions: {
        X: this.settings.homing.directionX,
        Y: this.settings.homing.directionY,
        Z: this.settings.homing.directionZ
      },
      mask
    });
  
    if (this.appState.isConnected) {
      this.appState.sendCommand(`$23=${mask}`);
      
      // Update the appState settings for the main application
      if (this.appState.settings) {
        this.appState.settings.$23 = mask;
      }
    }
  }

  // Calculate direction mask from settings
  calculateDirectionMask() {
    let mask = 0;
    if (this.settings.motorSettings.invertX) mask |= 1;
    if (this.settings.motorSettings.invertY) mask |= 2;
    if (this.settings.motorSettings.invertZ) mask |= 4;
    return mask;
  }

  // Calculate homing mask from settings
  calculateHomingMask() {
    let mask = 0;
    if (this.settings.homing.directionX === "+X") mask |= 1;
    if (this.settings.homing.directionY === "+Y") mask |= 2;
    if (this.settings.homing.directionZ === "+Z") mask |= 4;
    return mask;
  }

  // Navigation methods
  goToStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= this.steps.length) return;

    this.currentStep = stepIndex;
    const currentStepId = this.steps[stepIndex];

    // Update panels visibility
    this.elements.stepsPanels.forEach(panel => {
      panel.classList.remove('active');
    });

    const activePanel = document.getElementById(currentStepId);
    if (activePanel) {
      activePanel.classList.add('active');
    }

    // Update step list
    this.elements.stepsItems.forEach((item, i) => {
      if (i === stepIndex) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update navigation buttons
    if (this.elements.backBtn) {
      this.elements.backBtn.disabled = stepIndex === 0;
    }

    if (this.elements.nextBtn && this.elements.finishBtn) {
      const isLastStep = stepIndex === this.steps.length - 1;
      this.elements.nextBtn.style.display = isLastStep ? 'none' : 'inline-block';
      this.elements.finishBtn.style.display = isLastStep ? 'inline-block' : 'none';
    }
  }

  nextStep() {
    if (this.currentStep < this.steps.length - 1) {
      this.goToStep(this.currentStep + 1);
    }
  }

  previousStep() {
    if (this.currentStep > 0) {
      this.goToStep(this.currentStep - 1);
    }
  }

  // Finish the wizard
  finishWizard() {
    try {
      // Save all settings to the machine
      this.saveAllSettings();
      
      // Sync settings with the main app
      if (window.syncWizardSettingsWithApp) {
        window.syncWizardSettingsWithApp(this.settings);
      } else {
        console.warn("syncWizardSettingsWithApp function not found - settings may not be fully synchronized");
        
        // Fallback - update app state directly
        if (this.appState.settings) {
          // Motor settings
          this.appState.settings.$3 = this.calculateDirectionMask();
          
          // Calibration settings
          this.appState.settings.$100 = this.settings.calibration.stepsX;
          this.appState.settings.$101 = this.settings.calibration.stepsY;
          this.appState.settings.$102 = this.settings.calibration.stepsZ;
          this.appState.settings.stepsX = this.settings.calibration.stepsX;
          this.appState.settings.stepsY = this.settings.calibration.stepsY;
          this.appState.settings.stepsZ = this.settings.calibration.stepsZ;
          
          // Limit switches
          this.appState.settings.$21 = this.settings.limitSwitches.enabled ? 1 : 0;
          this.appState.settings.$5 = this.settings.limitSwitches.inverted ? 1 : 0;
          
          // Homing
          this.appState.settings.$22 = this.settings.homing.enabled ? 1 : 0;
          this.appState.settings.$23 = this.calculateHomingMask();
          this.appState.settings.homingEnabled = this.settings.homing.enabled ? 1 : 0;
          
          // Soft limits
          this.appState.settings.$20 = this.settings.softLimits.enabled ? 1 : 0;
          this.appState.settings.$130 = this.settings.softLimits.maxTravelX;
          this.appState.settings.$131 = this.settings.softLimits.maxTravelY;
          this.appState.settings.$132 = this.settings.softLimits.maxTravelZ;
          this.appState.settings.maxTravelX = this.settings.softLimits.maxTravelX;
          this.appState.settings.maxTravelY = this.settings.softLimits.maxTravelY;
          this.appState.settings.maxTravelZ = this.settings.softLimits.maxTravelZ;
        }
      }
      
      // Ask if user wants to save settings to a file
      const saveToFile = confirm('Setup completed successfully! Would you like to save these settings to a file for future use?');
      
      if (saveToFile) {
        this.saveSettingsToFile();
      }
      
      alert('Setup completed successfully!');
      
      // Clean up - remove handlers when closing
      if (this.appState.removeMessageHandler && this.limitSwitchHandler) {
        this.appState.removeMessageHandler(this.limitSwitchHandler);
      }
      
      if (this.appState.removePositionHandler && this.positionUpdateHandler) {
        this.appState.removePositionHandler(this.positionUpdateHandler);
      }
      
      this.close();
    } catch (error) {
      console.error("Error in finishWizard:", error);
      alert(`Error saving settings: ${error.message}\nSome settings may not have been saved correctly.`);
    }
  }

  // Save all settings to machine
  saveAllSettings() {
    if (!this.appState.isConnected) {
      alert('Machine not connected. Settings will be saved locally but not sent to machine.');
    }
  
    try {
      if (this.appState.isConnected) {
        // Motor settings
        const dirMask = this.calculateDirectionMask();
        this.appState.sendCommand(`$3=${dirMask}`);
        
        // Calibration settings - precise to 3 decimal places
        this.appState.sendCommand(`$100=${this.settings.calibration.stepsX.toFixed(3)}`);
        this.appState.sendCommand(`$101=${this.settings.calibration.stepsY.toFixed(3)}`);
        this.appState.sendCommand(`$102=${this.settings.calibration.stepsZ.toFixed(3)}`);
  
        // Limit switch settings
        this.appState.sendCommand(`$21=${this.settings.limitSwitches.enabled ? 1 : 0}`);
        this.appState.sendCommand(`$5=${this.settings.limitSwitches.inverted ? 1 : 0}`);
  
        // Homing settings
        this.appState.sendCommand(`$22=${this.settings.homing.enabled ? 1 : 0}`);
        const homingMask = this.calculateHomingMask();
        this.appState.sendCommand(`$23=${homingMask}`);
  
        // Soft limits settings
        this.appState.sendCommand(`$20=${this.settings.softLimits.enabled ? 1 : 0}`);
        this.appState.sendCommand(`$130=${this.settings.softLimits.maxTravelX}`);
        this.appState.sendCommand(`$131=${this.settings.softLimits.maxTravelY}`);
        this.appState.sendCommand(`$132=${this.settings.softLimits.maxTravelZ}`);
        
        // Log the completed settings save
        this.appState.addConsoleMessage('system', 'All machine settings saved successfully');
      }
  
      // Save to localStorage for persistence
      try {
        localStorage.setItem('cnc-settings', JSON.stringify(this.settings));
      } catch (e) {
        console.error("Error saving settings to localStorage:", e);
      }
  
      // Update app state settings object
      if (this.appState.settings) {
        // Motor settings
        this.appState.settings.$3 = this.calculateDirectionMask();
        
        // Limit switch settings
        this.appState.settings.$5 = this.settings.limitSwitches.inverted ? 1 : 0;
        this.appState.settings.$21 = this.settings.limitSwitches.enabled ? 1 : 0;
        
        // Soft limits
        this.appState.settings.$20 = this.settings.softLimits.enabled ? 1 : 0;
        
        // Homing
        this.appState.settings.$22 = this.settings.homing.enabled ? 1 : 0;
        this.appState.settings.$23 = this.calculateHomingMask();
        
        // Calibration settings
        this.appState.settings.$100 = this.settings.calibration.stepsX;
        this.appState.settings.$101 = this.settings.calibration.stepsY;
        this.appState.settings.$102 = this.settings.calibration.stepsZ;
        
        // Max travel settings
        this.appState.settings.$130 = this.settings.softLimits.maxTravelX;
        this.appState.settings.$131 = this.settings.softLimits.maxTravelY;
        this.appState.settings.$132 = this.settings.softLimits.maxTravelZ;
        
        // Also update normal settings keys used by the app
        this.appState.settings.stepsX = this.settings.calibration.stepsX;
        this.appState.settings.stepsY = this.settings.calibration.stepsY;
        this.appState.settings.stepsZ = this.settings.calibration.stepsZ;
        this.appState.settings.maxTravelX = this.settings.softLimits.maxTravelX;
        this.appState.settings.maxTravelY = this.settings.softLimits.maxTravelY;
        this.appState.settings.maxTravelZ = this.settings.softLimits.maxTravelZ;
        this.appState.settings.homingEnabled = this.settings.homing.enabled ? 1 : 0;
      }
      
      return true;
    } catch (error) {
      console.error("Error saving settings:", error);
      this.appState.addConsoleMessage('error', `Error saving settings: ${error.message}`);
      return false;
    }
  }

  // Show context-sensitive help
  showHelp() {
    const currentStepId = this.steps[this.currentStep];
    let helpTitle = "Help";
    let helpContent = "No help available for this step.";

    switch (currentStepId) {
      case 'welcome':
        helpTitle = "Connection Help";
        helpContent = "Make sure your CNC machine is connected via USB and powered on. If you're having connection issues, check that you have the correct port selected in the main application.";
        break;
        
      case 'import-settings':
        helpTitle = "Import Settings Help";
        helpContent = "If you have a settings file from the manufacturer or a previous setup, you can load it here to quickly configure your machine.";
        break;
        
      case 'motor-wiring':
        helpTitle = "Motor Wiring Help";
        helpContent = "Test each axis by clicking the movement buttons. The motors should move in the following directions:\n\n" +
          "• X+: Right\n• X-: Left\n• Y+: Away from you\n• Y-: Toward you\n• Z+: Up\n• Z-: Down\n\n" +
          "If a motor moves in the wrong direction, check the 'Reverse direction' box for that axis.";
        break;
        
      case 'step-calibration':
        helpTitle = "Step Calibration Help";
        helpContent = "Calibration ensures accurate movement:\n\n" +
          "1. Reset to zero\n" +
          "2. Move an axis (e.g. 10mm)\n" +
          "3. Measure the actual distance moved with a ruler\n" +
          "4. Enter the measured distance\n" +
          "5. Click Update to calculate and set the correct steps/mm\n\n" +
          "For best results, use a digital caliper and move at least 10mm.";
        break;
        
      case 'limit-switches':
        helpTitle = "Limit Switches Help";
        helpContent = "Limit switches prevent your machine from moving beyond its physical limits:\n\n" +
          "• Enable limit switches if your machine has them installed\n" +
          "• Test each switch by manually triggering it\n" +
          "• If the switches work but in reverse (triggered when not touched), check 'Invert limit switches'";
        break;
        
      case 'homing':
        helpTitle = "Homing Help";
        helpContent = "Homing establishes a consistent zero position:\n\n" +
          "• Enable homing if your machine has limit switches\n" +
          "• Set the direction each axis should move to find home\n" +
          "• Test homing and be ready to abort if the machine moves in the wrong direction\n\n" +
          "Typically, homing directions are -X, -Y, -Z (machine moves toward the limit switches).";
        break;
        
      case 'soft-limits':
        helpTitle = "Soft Limits Help";
        helpContent = "Soft limits prevent your machine from trying to move beyond its work area:\n\n" +
          "1. Home the machine first\n" +
          "2. Move each axis to its maximum safe position\n" +
          "3. Set the max travel distance for each axis\n\n" +
          "Soft limits require both homing and limit switches to be enabled.";
        break;
    }

    // Display the help in a modal dialog
    this.showHelpDialog(helpTitle, helpContent);
  }

  // Show a help dialog
  showHelpDialog(title, content) {
    // Remove any existing help dialog
    const existingDialog = document.getElementById('help-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    // Create the dialog
    const dialog = document.createElement('div');
    dialog.id = 'help-dialog';
    dialog.className = 'setup-wizard';
    dialog.innerHTML = `
      <div class="help-dialog-content">
        <div class="help-dialog-header">
          <h2>${title}</h2>
          <button id="close-help" class="close-help-btn">&times;</button>
        </div>
        <div class="help-dialog-body">${content}</div>
        <div class="help-dialog-footer">
          <button id="ok-help" class="btn-primary">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // Add event listeners
    document.getElementById('close-help').addEventListener('click', () => {
      dialog.remove();
    });

    document.getElementById('ok-help').addEventListener('click', () => {
      dialog.remove();
    });

    // Click outside to close
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.remove();
      }
    });
  }
}

// Export the module
export default {
  openSetupWizard,
  handlePortsList
};
