(function () {
  var token = new URLSearchParams(location.search).get('token');
  // Redirect valid-format tokens to download.html where the normal exchange flow handles them
  // Require exactly 32 hex chars — matches the server-side hexToken() output (128-bit).
  // A shorter accepted range would allow near-brute-forceable tokens to reach the server.
  if (token && /^[0-9a-f]{32}$/.test(token)) {
    window.location.replace('download.html?token=' + encodeURIComponent(token));
    return;
  }
  // Show the correct error card based on whether a token was present but invalid,
  // or no token at all
  document.addEventListener('DOMContentLoaded', function () {
    var cardId = token ? 'card-expired' : 'card-invalid';
    document.getElementById(cardId).style.display = '';
  });
})();
