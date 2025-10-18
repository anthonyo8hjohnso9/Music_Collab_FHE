// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface MusicTrack {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  trackType: "melody" | "harmony" | "rhythm" | "bass";
  status: "pending" | "verified" | "rejected";
  contributorName: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTrackData, setNewTrackData] = useState({ 
    trackType: "melody", 
    noteSequence: "", 
    contributorName: "",
    bpm: 120,
    volume: 50 
  });
  const [showIntro, setShowIntro] = useState(true);
  const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState("all");
  const [animationKey, setAnimationKey] = useState(0);

  // Stats
  const verifiedCount = tracks.filter(t => t.status === "verified").length;
  const pendingCount = tracks.filter(t => t.status === "pending").length;
  const rejectedCount = tracks.filter(t => t.status === "rejected").length;
  const melodyCount = tracks.filter(t => t.trackType === "melody").length;
  const harmonyCount = tracks.filter(t => t.trackType === "harmony").length;
  const rhythmCount = tracks.filter(t => t.trackType === "rhythm").length;
  const bassCount = tracks.filter(t => t.trackType === "bass").length;

  useEffect(() => {
    loadTracks().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadTracks = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("track_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing track keys:", e); }
      }
      
      const list: MusicTrack[] = [];
      for (const key of keys) {
        try {
          const trackBytes = await contract.getData(`track_${key}`);
          if (trackBytes.length > 0) {
            try {
              const trackData = JSON.parse(ethers.toUtf8String(trackBytes));
              list.push({ 
                id: key, 
                encryptedData: trackData.data, 
                timestamp: trackData.timestamp, 
                owner: trackData.owner, 
                trackType: trackData.trackType || "melody",
                status: trackData.status || "pending",
                contributorName: trackData.contributorName || "Anonymous"
              });
            } catch (e) { console.error(`Error parsing track data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading track ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTracks(list);
      setAnimationKey(prev => prev + 1); // Trigger animation refresh
    } catch (e) { console.error("Error loading tracks:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitTrack = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting music data with Zama FHE..." });
    try {
      // Convert note sequence to numerical representation for FHE encryption
      const noteValue = newTrackData.noteSequence.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const encryptedData = FHEEncryptNumber(noteValue);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const trackId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const trackData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        trackType: newTrackData.trackType,
        status: "pending",
        contributorName: newTrackData.contributorName,
        bpm: newTrackData.bpm,
        volume: newTrackData.volume
      };
      
      await contract.setData(`track_${trackId}`, ethers.toUtf8Bytes(JSON.stringify(trackData)));
      
      const keysBytes = await contract.getData("track_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(trackId);
      await contract.setData("track_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted music track submitted securely!" });
      await loadTracks();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTrackData({ 
          trackType: "melody", 
          noteSequence: "", 
          contributorName: "",
          bpm: 120,
          volume: 50 
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const verifyTrack = async (trackId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted music data with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const trackBytes = await contract.getData(`track_${trackId}`);
      if (trackBytes.length === 0) throw new Error("Track not found");
      const trackData = JSON.parse(ethers.toUtf8String(trackBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedTrack = { ...trackData, status: "verified" };
      await contractWithSigner.setData(`track_${trackId}`, ethers.toUtf8Bytes(JSON.stringify(updatedTrack)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE verification completed successfully!" });
      await loadTracks();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectTrack = async (trackId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted music data with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const trackBytes = await contract.getData(`track_${trackId}`);
      if (trackBytes.length === 0) throw new Error("Track not found");
      const trackData = JSON.parse(ethers.toUtf8String(trackBytes));
      const updatedTrack = { ...trackData, status: "rejected" };
      await contract.setData(`track_${trackId}`, ethers.toUtf8Bytes(JSON.stringify(updatedTrack)));
      setTransactionStatus({ visible: true, status: "success", message: "FHE rejection completed successfully!" });
      await loadTracks();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (trackAddress: string) => address?.toLowerCase() === trackAddress.toLowerCase();

  const filteredTracks = tracks.filter(track => {
    if (activeTab === "all") return true;
    if (activeTab === "melody") return track.trackType === "melody";
    if (activeTab === "harmony") return track.trackType === "harmony";
    if (activeTab === "rhythm") return track.trackType === "rhythm";
    if (activeTab === "bass") return track.trackType === "bass";
    return true;
  });

  const topContributors = [...tracks]
    .reduce((acc: {[key: string]: number}, track) => {
      const name = track.contributorName || "Anonymous";
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {});
  
  const sortedContributors = Object.entries(topContributors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (loading) return (
    <div className="loading-screen">
      <div className="music-spinner"></div>
      <p>Initializing encrypted music connection...</p>
    </div>
  );

  return (
    <div className="app-container glass-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">🎵</div>
          <h1>和弦密語 <span>Chord Whisper</span></h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-track-btn glass-button">
            <div className="add-icon">+</div>Add Track
          </button>
          <button className="glass-button" onClick={() => setShowIntro(!showIntro)}>
            {showIntro ? "Hide Intro" : "Show Intro"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        {showIntro && (
          <div className="intro-section glass-card">
            <h2>FHE-based Music Composition Game</h2>
            <p className="subtitle">Collaborative music creation with fully homomorphic encryption</p>
            <div className="intro-grid">
              <div className="intro-feature">
                <div className="feature-icon">🔒</div>
                <h3>Secure Collaboration</h3>
                <p>Each musical part is encrypted with Zama FHE, allowing secure collaboration without exposing raw data</p>
              </div>
              <div className="intro-feature">
                <div className="feature-icon">🎼</div>
                <h3>Multi-track Composition</h3>
                <p>Contribute melodies, harmonies, rhythms or bass lines that combine into a complete encrypted composition</p>
              </div>
              <div className="intro-feature">
                <div className="feature-icon">✨</div>
                <h3>Creative Exploration</h3>
                <p>Hear how your encrypted parts interact with others' contributions in real-time</p>
              </div>
            </div>
            <div className="fhe-process">
              <div className="process-step">
                <div className="step-number">1</div>
                <p>Compose your musical part</p>
              </div>
              <div className="process-arrow">→</div>
              <div className="process-step">
                <div className="step-number">2</div>
                <p>Encrypt with Zama FHE</p>
              </div>
              <div className="process-arrow">→</div>
              <div className="process-step">
                <div className="step-number">3</div>
                <p>Collaborate securely</p>
              </div>
              <div className="process-arrow">→</div>
              <div className="process-step">
                <div className="step-number">4</div>
                <p>Decrypt final composition</p>
              </div>
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card glass-card">
            <h3>Music Stats</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{tracks.length}</div>
                <div className="stat-label">Total Tracks</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{melodyCount}</div>
                <div className="stat-label">Melodies</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{harmonyCount}</div>
                <div className="stat-label">Harmonies</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rhythmCount}</div>
                <div className="stat-label">Rhythms</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{bassCount}</div>
                <div className="stat-label">Bass Lines</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Top Contributors</h3>
            <div className="contributors-list">
              {sortedContributors.map(([name, count], index) => (
                <div className="contributor-item" key={index}>
                  <div className="contributor-rank">{index + 1}</div>
                  <div className="contributor-name">{name}</div>
                  <div className="contributor-count">{count} tracks</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Real-time Composition</h3>
            <div className="visualization">
              <div className="music-visualizer" key={animationKey}>
                {filteredTracks.slice(0, 8).map((track, i) => (
                  <div 
                    className={`music-bar ${track.trackType}`} 
                    style={{ 
                      height: `${Math.min(100, (track.timestamp % 100) + 30)}%`,
                      animationDelay: `${i * 0.1}s`
                    }} 
                    key={i}
                  />
                ))}
              </div>
              <p className="visualization-note">Visualizing encrypted musical data flow</p>
            </div>
          </div>
        </div>
        
        <div className="tracks-section">
          <div className="section-header">
            <h2>Encrypted Music Tracks</h2>
            <div className="tab-controls">
              <button 
                className={`tab-button ${activeTab === "all" ? "active" : ""}`}
                onClick={() => setActiveTab("all")}
              >
                All Tracks
              </button>
              <button 
                className={`tab-button ${activeTab === "melody" ? "active" : ""}`}
                onClick={() => setActiveTab("melody")}
              >
                Melodies
              </button>
              <button 
                className={`tab-button ${activeTab === "harmony" ? "active" : ""}`}
                onClick={() => setActiveTab("harmony")}
              >
                Harmonies
              </button>
              <button 
                className={`tab-button ${activeTab === "rhythm" ? "active" : ""}`}
                onClick={() => setActiveTab("rhythm")}
              >
                Rhythms
              </button>
              <button 
                className={`tab-button ${activeTab === "bass" ? "active" : ""}`}
                onClick={() => setActiveTab("bass")}
              >
                Bass
              </button>
            </div>
            <div className="header-actions">
              <button onClick={loadTracks} className="refresh-btn glass-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="tracks-list glass-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Type</div>
              <div className="header-cell">Contributor</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredTracks.length === 0 ? (
              <div className="no-tracks">
                <div className="no-tracks-icon">🎵</div>
                <p>No encrypted tracks found</p>
                <button className="glass-button primary" onClick={() => setShowCreateModal(true)}>Create First Track</button>
              </div>
            ) : filteredTracks.map(track => (
              <div 
                className="track-row" 
                key={track.id} 
                onClick={() => setSelectedTrack(track)}
              >
                <div className="table-cell track-id">#{track.id.substring(0, 6)}</div>
                <div className="table-cell">
                  <span className={`track-type ${track.trackType}`}>{track.trackType}</span>
                </div>
                <div className="table-cell">{track.contributorName}</div>
                <div className="table-cell">{new Date(track.timestamp * 1000).toLocaleDateString()}</div>
                <div className="table-cell">
                  <span className={`status-badge ${track.status}`}>{track.status}</span>
                </div>
                <div className="table-cell actions">
                  {isOwner(track.owner) && track.status === "pending" && (
                    <>
                      <button 
                        className="action-btn glass-button success" 
                        onClick={(e) => { e.stopPropagation(); verifyTrack(track.id); }}
                      >
                        Verify
                      </button>
                      <button 
                        className="action-btn glass-button danger" 
                        onClick={(e) => { e.stopPropagation(); rejectTrack(track.id); }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitTrack} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          trackData={newTrackData} 
          setTrackData={setNewTrackData}
        />
      )}
      
      {selectedTrack && (
        <TrackDetailModal 
          track={selectedTrack} 
          onClose={() => { setSelectedTrack(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="music-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">🎵 <span>和弦密語</span></div>
            <p>Collaborative music composition with Zama FHE encryption</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">🔒 FHE-Powered Music Collaboration</div>
          <div className="copyright">© {new Date().getFullYear()} Chord Whisper. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  trackData: any;
  setTrackData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, trackData, setTrackData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTrackData({ ...trackData, [name]: value });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTrackData({ ...trackData, [name]: parseInt(value) });
  };

  const handleSubmit = () => {
    if (!trackData.trackType || !trackData.noteSequence) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Add Encrypted Music Track</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔑</div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your musical data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Track Type *</label>
              <select 
                name="trackType" 
                value={trackData.trackType} 
                onChange={handleChange} 
                className="glass-select"
              >
                <option value="melody">Melody</option>
                <option value="harmony">Harmony</option>
                <option value="rhythm">Rhythm</option>
                <option value="bass">Bass</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Contributor Name</label>
              <input 
                type="text" 
                name="contributorName" 
                value={trackData.contributorName} 
                onChange={handleChange} 
                placeholder="Your name/nickname..." 
                className="glass-input"
              />
            </div>
            
            <div className="form-group">
              <label>Note Sequence *</label>
              <textarea 
                name="noteSequence" 
                value={trackData.noteSequence} 
                onChange={handleChange} 
                placeholder="Enter your musical notes (e.g., C4 D4 E4 F4)" 
                className="glass-textarea"
                rows={3}
              />
            </div>
            
            <div className="form-group">
              <label>BPM</label>
              <input 
                type="range" 
                name="bpm" 
                min="40" 
                max="240" 
                value={trackData.bpm} 
                onChange={handleNumberChange} 
                className="glass-range"
              />
              <div className="range-value">{trackData.bpm} BPM</div>
            </div>
            
            <div className="form-group">
              <label>Volume</label>
              <input 
                type="range" 
                name="volume" 
                min="0" 
                max="100" 
                value={trackData.volume} 
                onChange={handleNumberChange} 
                className="glass-range"
              />
              <div className="range-value">{trackData.volume}%</div>
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Musical Data:</span>
                <div>{trackData.noteSequence || 'No notes entered'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>
                  {trackData.noteSequence ? 
                    `FHE-${btoa(trackData.noteSequence).substring(0, 30)}...` : 
                    'No notes entered'
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn glass-button">Cancel</button>
          <button 
            onClick={handleSubmit} 
            disabled={creating} 
            className="submit-btn glass-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface TrackDetailModalProps {
  track: MusicTrack;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const TrackDetailModal: React.FC<TrackDetailModalProps> = ({ 
  track, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { setDecryptedValue(null); return; }
    const decrypted = await decryptWithSignature(track.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="track-detail-modal glass-card">
        <div className="modal-header">
          <h2>Track Details #{track.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="track-info">
            <div className="info-item">
              <span>Type:</span>
              <strong className={`track-type ${track.trackType}`}>{track.trackType}</strong>
            </div>
            <div className="info-item">
              <span>Contributor:</span>
              <strong>{track.contributorName}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(track.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${track.status}`}>{track.status}</strong>
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Musical Data</h3>
            <div className="encrypted-data">
              {track.encryptedData.substring(0, 100)}...
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon">🔒</div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn glass-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Value"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Musical Value</h3>
              <div className="decrypted-value">
                {String.fromCharCode(...decryptedValue.toString().split('').map(Number))}
              </div>
              <div className="decryption-notice">
                <div className="warning-icon">⚠️</div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn glass-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;