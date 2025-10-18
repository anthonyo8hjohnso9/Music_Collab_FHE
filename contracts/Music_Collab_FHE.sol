pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MusicCollabFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error InvalidBatch();
    error InvalidStateHash();
    error ReplayAttempt();
    error InvalidProof();
    error NotInitialized();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSet(uint256 cooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event PausedContract();
    event UnpausedContract();
    event VoicePartSubmitted(address indexed provider, uint256 indexed batchId, uint256 voicePartId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId);

    struct VoicePart {
        euint32 pitch;
        euint32 duration;
        euint32 velocity;
    }

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    mapping(uint256 => mapping(address => VoicePart)) public encryptedVoiceParts;
    mapping(address => bool) public isProvider;
    mapping(uint256 => bool) public batchOpen;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    uint256 public cooldownSeconds;
    uint256 public currentBatchId;
    bool public paused;

    modifier onlyOwner() {
        if (msg.sender != owner()) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown(address _provider) {
        if (block.timestamp < lastSubmissionTime[_provider] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown(address _provider) {
        if (block.timestamp < lastDecryptionRequestTime[_provider] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        cooldownSeconds = 60; // Default cooldown: 1 minute
        currentBatchId = 1;   // Start with batch 1
        _openBatch(currentBatchId);
    }

    function addProvider(address _provider) external onlyOwner {
        isProvider[_provider] = true;
        emit ProviderAdded(_provider);
    }

    function removeProvider(address _provider) external onlyOwner {
        isProvider[_provider] = false;
        emit ProviderRemoved(_provider);
    }

    function setCooldown(uint256 _cooldownSeconds) external onlyOwner {
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSet(_cooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit PausedContract();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit UnpausedContract();
    }

    function openNewBatch() external onlyOwner {
        currentBatchId++;
        _openBatch(currentBatchId);
    }

    function closeBatch(uint256 _batchId) external onlyOwner {
        if (!batchOpen[_batchId]) revert InvalidBatch();
        batchOpen[_batchId] = false;
        emit BatchClosed(_batchId);
    }

    function submitVoicePart(
        uint256 _batchId,
        euint32 _pitch,
        euint32 _duration,
        euint32 _velocity
    ) external onlyProvider whenNotPaused checkSubmissionCooldown(msg.sender) {
        if (!batchOpen[_batchId]) revert InvalidBatch();
        _initIfNeeded(_pitch);
        _initIfNeeded(_duration);
        _initIfNeeded(_velocity);

        encryptedVoiceParts[_batchId][msg.sender] = VoicePart(_pitch, _duration, _velocity);
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit VoicePartSubmitted(msg.sender, _batchId, 0); // voicePartId not used in this simple version
    }

    function requestBatchDecryption(uint256 _batchId) external onlyProvider whenNotPaused checkDecryptionCooldown(msg.sender) {
        if (batchOpen[_batchId]) revert InvalidBatch(); // Batch must be closed for decryption

        bytes32[] memory cts = _prepareCiphertextsForBatch(_batchId);
        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: _batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, _batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        // @dev Replay protection: ensure this callback hasn't been processed
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        // @dev State consistency: rebuild ciphertexts from current storage and verify hash
        // This ensures the contract state hasn't changed since the decryption was requested.
        bytes32[] memory currentCts = _prepareCiphertextsForBatch(decryptionContexts[requestId].batchId);
        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != decryptionContexts[requestId].stateHash) revert InvalidStateHash();

        // @dev Verify the proof of correct decryption from the FHEVM network
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        // @dev For this example, we just mark as processed. Actual cleartext processing would happen here.
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId);
    }

    function _openBatch(uint256 _batchId) private {
        batchOpen[_batchId] = true;
        emit BatchOpened(_batchId);
    }

    function _hashCiphertexts(bytes32[] memory cts) private pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 x) private view {
        if (!x.isInitialized()) revert NotInitialized();
    }

    function _requireInitialized(euint32 x) private view {
        _initIfNeeded(x);
    }

    function _prepareCiphertextsForBatch(uint256 _batchId) private view returns (bytes32[] memory) {
        // This is a simplified example. A real implementation would iterate through providers
        // and collect all ciphertexts for the batch.
        // For now, it returns an empty array as a placeholder.
        // The actual implementation would need to know which providers submitted to this batch.
        // Example: if there are N providers, this array would have 3*N elements (pitch, duration, velocity for each).
        // The order must be fixed and consistent.
        address[] memory providers = new address[](0); // Placeholder: get actual providers for the batch
        bytes32[] memory cts = new bytes32[](providers.length * 3);

        // uint256 idx = 0;
        // for (uint256 i = 0; i < providers.length; i++) {
        //     VoicePart memory part = encryptedVoiceParts[_batchId][providers[i]];
        //     cts[idx++] = part.pitch.toBytes32();
        //     cts[idx++] = part.duration.toBytes32();
        //     cts[idx++] = part.velocity.toBytes32();
        // }
        return cts;
    }
}