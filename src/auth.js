const querystring = require('querystring');
let agents = {}; // Local cache of agent data, keyed by authenication token

async function lucosauth(req, res, next) {

	const cookies = querystring.parse(req.headers.cookie, '; ');

	// Token in GET parameter takes precedence over cookie.
	// This allows for a case where the cookie has a bad token, but the user has just returned from the authentication service with a fresh one
	// It should also support useragents which don't have cookies (though the user will have to hit the auth service between each new page)
	const token = req.query.token || cookies.auth_token;

	// If we've already validated the given token before, approved immediately
	if (token && agents[token]) {
		return authenticationVerified();
	}

	// Otherwise, if there's a token, verify it against the authentication service
	if (token) {
		const authurl = 'https://auth.l42.eu/data?' + querystring.stringify({ token });
		try {
			const auth_resp = await fetch(authurl);
			if (auth_resp.status !== 200) throw new Error(`Bad Status Code from auth server ${auth_resp.status}`);
			agents[token] = await auth_resp.json(); // Cache the data locally, so we don't need to make a call for this token in future
			return authenticationVerified();
		} catch (error) {
			console.error("Failed to auth ", error);
		}
	}

	// If no token was given, or the token wasn't successfully verified, send the user to the authentication service to log in
	const protocol = req.query['X-Forwarded-Proto'] || 'http';
	return res.redirect(302, "https://auth.l42.eu/authenticate?redirect_uri="+encodeURIComponent(protocol+'://'+req.headers.host+req.originalUrl));

	function authenticationVerified() {
		res.auth_agent = agents[token];
		if (cookies.auth_token !== token) res.cookie('auth_token', token);
		next();
	}
}

module.exports = lucosauth;