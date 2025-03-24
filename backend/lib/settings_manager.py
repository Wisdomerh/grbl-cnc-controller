# backend/settings_manager.py
import json
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

class SettingsManager:
    """Manages application and machine settings"""
    
    def __init__(self, config_dir=None):
        """
        Initialize the settings manager
        
        Args:
            config_dir (str): Directory to store settings files
        """
        # Set default config directory if not provided
        if config_dir is None:
            home_dir = str(Path.home())
            self.config_dir = os.path.join(home_dir, '.cnc_control')
        else:
            self.config_dir = config_dir
            
        # Create config directory if it doesn't exist
        os.makedirs(self.config_dir, exist_ok=True)
        
        # Default settings
        self.app_settings = {
            'recent_files': [],
            'default_feed_rate': 500,
            'default_spindle_speed': 1000,
            'visualizer_settings': {
                'show_grid': True,
                'show_axes': True,
                'toolpath_color': '#00ff00',
                'rapid_color': '#ff0000',
                'background_color': '#1a1a1a'
            }
        }
        
        self.machine_settings = {}
        
        # Load settings if they exist
        self.load_settings()
    
    def load_settings(self):
        """Load settings from disk"""
        try:
            app_settings_path = os.path.join(self.config_dir, 'app_settings.json')
            if os.path.exists(app_settings_path):
                with open(app_settings_path, 'r') as f:
                    self.app_settings.update(json.load(f))
            
            machine_settings_path = os.path.join(self.config_dir, 'machine_settings.json')
            if os.path.exists(machine_settings_path):
                with open(machine_settings_path, 'r') as f:
                    self.machine_settings = json.load(f)
                    
            logger.info("Settings loaded successfully")
            
        except Exception as e:
            logger.error(f"Error loading settings: {str(e)}")
    
    def save_settings(self):
        """Save settings to disk"""
        try:
            app_settings_path = os.path.join(self.config_dir, 'app_settings.json')
            with open(app_settings_path, 'w') as f:
                json.dump(self.app_settings, f, indent=2)
            
            machine_settings_path = os.path.join(self.config_dir, 'machine_settings.json')
            with open(machine_settings_path, 'w') as f:
                json.dump(self.machine_settings, f, indent=2)
                
            logger.info("Settings saved successfully")
            
        except Exception as e:
            logger.error(f"Error saving settings: {str(e)}")
    
    def get_app_setting(self, key, default=None):
        """
        Get an application setting
        
        Args:
            key (str): Setting key
            default: Default value if key doesn't exist
        
        Returns:
            The setting value
        """
        return self.app_settings.get(key, default)
    
    def set_app_setting(self, key, value):
        """
        Set an application setting
        
        Args:
            key (str): Setting key
            value: Setting value
        """
        self.app_settings[key] = value
        self.save_settings()
    
    def add_recent_file(self, file_path):
        """
        Add a file to recent files list
        
        Args:
            file_path (str): Path to the file
        """
        recent_files = self.app_settings.get('recent_files', [])
        
        # If the file is already in the list, remove it
        if file_path in recent_files:
            recent_files.remove(file_path)
        
        # Add to the beginning of the list
        recent_files.insert(0, file_path)
        
        # Limit the list to 10 items
        self.app_settings['recent_files'] = recent_files[:10]
        
        self.save_settings()
    
    def get_recent_files(self):
        """
        Get list of recent files
        
        Returns:
            list: List of recent files
        """
        return self.app_settings.get('recent_files', [])
    
    def save_machine_profile(self, name, settings):
        """
        Save machine settings profile
        
        Args:
            name (str): Profile name
            settings (dict): Machine settings
        """
        self.machine_settings[name] = settings
        self.save_settings()
    
    def get_machine_profile(self, name):
        """
        Get machine settings profile
        
        Args:
            name (str): Profile name
        
        Returns:
            dict: Machine settings or None if not found
        """
        return self.machine_settings.get(name)
    
    def get_machine_profiles(self):
        """
        Get all machine profiles
        
        Returns:
            dict: Dictionary of machine profiles
        """
        return self.machine_settings
    
    def delete_machine_profile(self, name):
        """
        Delete a machine profile
        
        Args:
            name (str): Profile name
        
        Returns:
            bool: True if deleted, False if not found
        """
        if name in self.machine_settings:
            del self.machine_settings[name]
            self.save_settings()
            return True
        
        return False