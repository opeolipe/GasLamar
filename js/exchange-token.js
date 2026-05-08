(function () {
  var token = new URLSearchParams(location.search).get('token');
  // Redirect valid-format tokens to download.html where the normal exchange flow handles them
  if (token && /^[0-9a-f]{1,128}$/.test(token)) {
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
