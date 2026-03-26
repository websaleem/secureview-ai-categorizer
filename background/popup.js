document.addEventListener('DOMContentLoaded', () => {
  const listElement = document.getElementById('history-list');

  const query = {
    text: '', 
    maxResults: 100 
  };

  chrome.history.search(query, (results) => {
    listElement.innerHTML = ''; 

    if (results.length === 0) {
      listElement.innerHTML = '<li class="empty-state">No recent history found.</li>';
      return;
    }

    results.forEach((page) => {
      // 1. Main container for the history item
      const li = document.createElement('li');
      li.className = 'history-item';
      
      // Try to extract a clean domain name for favicons and display
      let domain = '';
      try {
        domain = new URL(page.url).hostname;
      } catch (e) {
        domain = 'unknown';
      }

      // 2. Favicon for quick visual recognition
      const favicon = document.createElement('img');
      favicon.className = 'favicon';
      // Using Google's favicon service as a reliable fallback
      favicon.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
      favicon.alt = '';

      // 3. Content wrapper (Title, URL, and Category Badge)
      const contentDiv = document.createElement('div');
      contentDiv.className = 'item-content';

      const titleHeader = document.createElement('div');
      titleHeader.className = 'item-header';

      const titleLink = document.createElement('a');
      titleLink.className = 'item-title';
      titleLink.textContent = page.title || domain || 'Untitled Page';
      titleLink.href = page.url;
      titleLink.title = page.title || page.url; 
      titleLink.target = '_blank'; 

      // UI Placeholder ready for your local LLM categorization engine
      const categoryBadge = document.createElement('span');
      categoryBadge.className = 'category-badge';
      categoryBadge.textContent = 'Analyzing...'; 

      titleHeader.appendChild(titleLink);
      titleHeader.appendChild(categoryBadge);

      const urlSpan = document.createElement('span');
      urlSpan.className = 'item-url';
      urlSpan.textContent = domain; // Showing just the domain is much cleaner than the full URL

      contentDiv.appendChild(titleHeader);
      contentDiv.appendChild(urlSpan);

      // 4. Timestamp
      const timeSpan = document.createElement('span');
      timeSpan.className = 'item-time';
      if (page.lastVisitTime) {
        const date = new Date(page.lastVisitTime);
        timeSpan.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      // 5. Assemble and append
      li.appendChild(favicon);
      li.appendChild(contentDiv);
      li.appendChild(timeSpan);
      
      listElement.appendChild(li);
    });
  });
});