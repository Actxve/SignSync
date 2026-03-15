/**
 * captions.js — Sequential auto-disappearing caption display
 *
 * Captions appear one after another in a list.
 * Each caption has its own independent 8-second timer.
 * When a timer expires, that specific caption is removed from the DOM.
 * This ensures the peer can read everything in sequence.
 */

const CAPTION_TTL = 8000; // 8 seconds

/**
 * Display a caption in the sequence and set an 8-second expiry timer.
 * @param {'speech'|'sign'} type
 * @param {string} text
 */
function addCaption(type, text) {
  const area = document.getElementById('caption-area');
  
  // Remove placeholder on first real caption if it exists
  const placeholder = area.querySelector('.caption-placeholder');
  if (placeholder) placeholder.remove();

  // Create caption element
  const entry = document.createElement('p');
  entry.className = `caption-entry ${type}`;
  
  // Build label without emojis
  const labelText = type === 'speech' ? 'Speech: ' : 'Sign: ';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = labelText;

  entry.appendChild(label);
  entry.appendChild(document.createTextNode(text));
  area.appendChild(entry);

  // Auto-scroll to show the latest caption
  area.scrollTop = area.scrollHeight;

  // Start independent 8-second timer for this specific entry
  setTimeout(() => {
    // Fade out effect
    entry.style.transition = 'opacity 0.5s ease-out';
    entry.style.opacity = '0';
    
    // Remove from DOM after fade
    setTimeout(() => {
      if (entry.parentNode === area) {
        entry.remove();
        
        // If no more entries, put placeholder back
        if (area.querySelectorAll('.caption-entry').length === 0) {
          area.innerHTML = '<p class="caption-placeholder">Captions will appear here…</p>';
        }
      }
    }, 500);
  }, CAPTION_TTL);
}

/** Reset caption area (called on call end). */
function clearCaptions() {
  const area = document.getElementById('caption-area');
  if (area) {
    area.innerHTML = '<p class="caption-placeholder">Captions will appear here…</p>';
  }
}
