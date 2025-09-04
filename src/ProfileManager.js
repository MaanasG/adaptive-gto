import React, { useState, useEffect } from 'react';

/**
 * ProfileManager Component - Phase 1 Implementation
 * 
 * Handles:
 * - Player profile creation/editing
 * - Hand history import/parsing  
 * - Statistics calculation
 * - Profile save/load to localStorage
 * - Profile selection for strategy generation
 */

const ProfileManager = ({ 
  onProfileChange, 
  currentProfile, 
  baselineGTO 
}) => {
  const [profiles, setProfiles] = useState({});
  const [selectedProfileId, setSelectedProfileId] = useState('baseline');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  // Load profiles from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('pokerProfiles');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setProfiles(parsed);
      } catch (e) {
        console.error('Failed to load profiles:', e);
      }
    }
  }, []);

  // Save profiles to localStorage when profiles change
  useEffect(() => {
    if (Object.keys(profiles).length > 0) {
      localStorage.setItem('pokerProfiles', JSON.stringify(profiles));
    }
  }, [profiles]);

  // Notify parent when profile selection changes
  useEffect(() => {
    const profile = selectedProfileId === 'baseline' 
      ? { id: 'baseline', strategy: baselineGTO, stats: null }
      : profiles[selectedProfileId];
    
    if (profile && onProfileChange) {
      onProfileChange(profile);
    }
  }, [selectedProfileId, profiles, onProfileChange, baselineGTO]);

  const createProfile = (profileData) => {
    const profile = {
      id: profileData.id,
      name: profileData.name,
      stats: profileData.stats || {},
      strategy: generateStrategyFromStats(profileData.stats || {}, baselineGTO),
      metadata: {
        handsAnalyzed: profileData.handsAnalyzed || 0,
        confidence: calculateConfidence(profileData.handsAnalyzed || 0),
        lastUpdated: new Date().toISOString(),
        gameType: profileData.gameType || "6-max NLHE"
      }
    };

    setProfiles(prev => ({
      ...prev,
      [profile.id]: profile
    }));

    setSelectedProfileId(profile.id);
    setShowCreateModal(false);
  };

  const deleteProfile = (profileId) => {
    if (profileId === 'baseline') return;
    
    setProfiles(prev => {
      const updated = { ...prev };
      delete updated[profileId];
      return updated;
    });

    if (selectedProfileId === profileId) {
      setSelectedProfileId('baseline');
    }
  };

  const importHandHistories = (handHistories, profileName) => {
    const stats = calculateStatsFromHands(handHistories);
    const profileId = `profile_${Date.now()}`;
    
    createProfile({
      id: profileId,
      name: profileName,
      stats,
      handsAnalyzed: handHistories.length,
      gameType: "6-max NLHE"
    });

    setShowImportModal(false);
  };

  const exportProfile = (profileId) => {
    const profile = profiles[profileId];
    if (!profile) return;

    const dataStr = JSON.stringify(profile, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${profile.name}_profile.json`;
    link.click();
    
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Profile Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Active Profile:</label>
          <select
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm"
          >
            <option value="baseline">Baseline GTO</option>
            {Object.values(profiles).map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
          >
            Create Profile
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="px-3 py-1 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
          >
            Import Hands
          </button>
        </div>
      </div>

      {/* Current Profile Info */}
      {selectedProfileId !== 'baseline' && profiles[selectedProfileId] && (
        <ProfileInfo 
          profile={profiles[selectedProfileId]} 
          onDelete={() => deleteProfile(selectedProfileId)}
          onExport={() => exportProfile(selectedProfileId)}
        />
      )}

      {/* Create Profile Modal */}
      {showCreateModal && (
        <CreateProfileModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createProfile}
        />
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportHandsModal
          onClose={() => setShowImportModal(false)}
          onImport={importHandHistories}
        />
      )}
    </div>
  );
};

// Profile Info Component
const ProfileInfo = ({ profile, onDelete, onExport }) => (
  <div className="p-4 bg-gray-50 rounded-lg border">
    <div className="flex justify-between items-start">
      <div>
        <h4 className="font-semibold text-gray-800">{profile.name}</h4>
        <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-600">VPIP:</span>
            <span className="ml-2 font-medium">{profile.stats.vpip?.toFixed(1) || 'N/A'}%</span>
          </div>
          <div>
            <span className="text-gray-600">PFR:</span>
            <span className="ml-2 font-medium">{profile.stats.pfr?.toFixed(1) || 'N/A'}%</span>
          </div>
          <div>
            <span className="text-gray-600">Fold to 3-bet:</span>
            <span className="ml-2 font-medium">{profile.stats.foldTo3Bet?.toFixed(1) || 'N/A'}%</span>
          </div>
          <div>
            <span className="text-gray-600">Hands:</span>
            <span className="ml-2 font-medium">{profile.metadata.handsAnalyzed}</span>
          </div>
        </div>
        <div className="mt-2">
          <span className={`px-2 py-1 rounded text-xs font-semibold ${
            profile.metadata.confidence > 0.8 ? 'bg-green-100 text-green-800' :
            profile.metadata.confidence > 0.6 ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }`}>
            {(profile.metadata.confidence * 100).toFixed(0)}% Confidence
          </span>
        </div>
      </div>
      
      <div className="flex gap-2">
        <button
          onClick={onExport}
          className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
        >
          Export
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-1 bg-red-200 text-red-700 rounded text-xs hover:bg-red-300"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
);

// Create Profile Modal
const CreateProfileModal = ({ onClose, onCreate }) => {
  const [formData, setFormData] = useState({
    name: '',
    vpip: '',
    pfr: '',
    foldTo3Bet: '',
    aggression: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const stats = {
      vpip: parseFloat(formData.vpip) || 0,
      pfr: parseFloat(formData.pfr) || 0,
      foldTo3Bet: parseFloat(formData.foldTo3Bet) || 65,
      aggression: parseFloat(formData.aggression) || 1.0
    };

    onCreate({
      id: `manual_${Date.now()}`,
      name: formData.name,
      stats,
      handsAnalyzed: 100, // Assume manual entry represents reasonable sample
      gameType: "6-max NLHE"
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">Create Manual Profile</h3>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Profile Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">VPIP (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.vpip}
                onChange={(e) => setFormData({...formData, vpip: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">PFR (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.pfr}
                onChange={(e) => setFormData({...formData, pfr: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Fold to 3-bet (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.foldTo3Bet}
                onChange={(e) => setFormData({...formData, foldTo3Bet: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Aggression</label>
              <input
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={formData.aggression}
                onChange={(e) => setFormData({...formData, aggression: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Create Profile
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Import Hands Modal
const ImportHandsModal = ({ onClose, onImport }) => {
  const [handData, setHandData] = useState('');
  const [profileName, setProfileName] = useState('');
  const [format, setFormat] = useState('json');

  const handleImport = () => {
    try {
      let hands = [];
      
      if (format === 'json') {
        hands = JSON.parse(handData);
      } else {
        // Could add PT4/HM2/other parsers here
        throw new Error('Format not yet supported');
      }

      if (!Array.isArray(hands) || hands.length === 0) {
        throw new Error('Invalid hand data format');
      }

      onImport(hands, profileName || 'Imported Profile');
      
    } catch (error) {
      alert('Error importing hands: ' + error.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Import Hand Histories</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Profile Name</label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="e.g., Aggressive Villain"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="json">JSON</option>
              <option value="pt4" disabled>PokerTracker 4 (Coming Soon)</option>
              <option value="hm2" disabled>Hold'em Manager 2 (Coming Soon)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Hand Data</label>
            <textarea
              value={handData}
              onChange={(e) => setHandData(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
              rows={12}
              placeholder={`Paste JSON hand histories here, format:
[
  {
    "handId": "123",
    "heroCards": ["Ah", "Kd"],
    "actions": [
      {"player": "Hero", "street": "preflop", "action": "raise", "amount": 2.5},
      {"player": "Villain", "street": "preflop", "action": "call", "amount": 2.5}
    ],
    "winner": "Hero"
  }
]`}
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              disabled={!handData.trim() || !profileName.trim()}
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper Functions

function calculateStatsFromHands(handHistories) {
  // Simplified stats calculation - replace with more sophisticated analysis
  const stats = {
    vpip: 0,
    pfr: 0,
    foldTo3Bet: 0,
    aggression: 1.0,
    handsPlayed: handHistories.length
  };

  let vpipCount = 0;
  let pfrCount = 0;
  let foldTo3BetCount = 0;
  let opportunities = 0;

  handHistories.forEach(hand => {
    const heroActions = hand.actions?.filter(a => a.player === 'Hero') || [];
    const preflopActions = heroActions.filter(a => a.street === 'preflop');
    
    // VPIP: Voluntarily put money in pot preflop
    if (preflopActions.some(a => ['call', 'raise', 'bet'].includes(a.action))) {
      vpipCount++;
    }

    // PFR: Preflop raise
    if (preflopActions.some(a => a.action === 'raise')) {
      pfrCount++;
    }

    // Fold to 3-bet (simplified)
    const faced3Bet = hand.actions?.some(a => 
      a.player !== 'Hero' && a.street === 'preflop' && a.action === 'raise'
    );
    if (faced3Bet) {
      opportunities++;
      if (preflopActions.some(a => a.action === 'fold')) {
        foldTo3BetCount++;
      }
    }
  });

  stats.vpip = handHistories.length > 0 ? (vpipCount / handHistories.length) * 100 : 0;
  stats.pfr = handHistories.length > 0 ? (pfrCount / handHistories.length) * 100 : 0;
  stats.foldTo3Bet = opportunities > 0 ? (foldTo3BetCount / opportunities) * 100 : 65; // Default GTO

  return stats;
}

function generateStrategyFromStats(stats, baselineGTO) {
  // Generate adjusted strategy based on opponent stats
  // This is where the real GTO adaptation logic goes
  
  const adjustmentFactor = Math.min(Math.abs(stats.foldTo3Bet - 65) / 100, 0.3);
  const newStrategy = {};

  Object.keys(baselineGTO).forEach(hand => {
    const baseline = baselineGTO[hand];
    
    if (stats.foldTo3Bet > 75) {
      // Opponent folds too much - widen our raising range
      newStrategy[hand] = {
        fold: Math.max(0, baseline.fold - adjustmentFactor * 20),
        call: baseline.call + adjustmentFactor * 5,
        raise: baseline.raise + adjustmentFactor * 15
      };
    } else if (stats.foldTo3Bet < 50) {
      // Opponent doesn't fold enough - tighten our raising range  
      newStrategy[hand] = {
        fold: Math.min(100, baseline.fold + adjustmentFactor * 25),
        call: Math.max(0, baseline.call - adjustmentFactor * 10),
        raise: Math.max(0, baseline.raise - adjustmentFactor * 15)
      };
    } else {
      newStrategy[hand] = baseline;
    }
  });

  return newStrategy;
}

function calculateConfidence(handsAnalyzed) {
  // Simple confidence calculation based on sample size
  if (handsAnalyzed < 50) return 0.3;
  if (handsAnalyzed < 200) return 0.6;
  if (handsAnalyzed < 1000) return 0.8;
  return 0.95;
}

export default ProfileManager;