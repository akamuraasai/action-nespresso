import util from 'util';
import * as Firestore from './firestore';

export const getUser = async (headers) => {
  const authorization = headers.authorization;
  const accessToken = (authorization || '').substr(7);
  return await Firestore.getUserId(accessToken);
};

export const registerAuthEndpoints = async (expressApp) => {
  expressApp.get('/login', (req, res) => {
    res.send(`
      <html>
        <body>
          <form action="/login" method="post">
            <input type="hidden" name="responseurl" value="${req.query.responseurl}" />
            <button type="submit" style="font-size:14pt">Link this service to Google</button>
          </form>
        </body>
      </html>
    `);
  });

  expressApp.post('/login', async (req, res) => {
    const responseurl = decodeURIComponent(req.body.responseurl);
    console.log(`Redirect to ${responseurl}`);
    return res.redirect(responseurl);
  });

  expressApp.get('/fakeauth', async (req, res) => {
    const responseurl = util.format(
      '%s?code=%s&state=%s',
      decodeURIComponent(req.query.redirect_uri),
      'xxxxxx',
      req.query.state,
    );
    console.log(`Set redirect as ${responseurl}`);
    return res.redirect(`/login?responseurl=${encodeURIComponent(responseurl)}`);
  });

  expressApp.all('/faketoken', async (req, res) => {
    const grantType = req.query.grant_type
      ? req.query.grant_type
      : req.body.grant_type;
    const secondsInDay = 86400;
    const HTTP_STATUS_OK = 200;
    console.log(`Grant type ${grantType}`);

    let obj;
    if (grantType === 'authorization_code') {
      obj = {
        token_type: 'bearer',
        access_token: '123access',
        refresh_token: '123refresh',
        expires_in: secondsInDay,
      };
    } else if (grantType === 'refresh_token') {
      obj = {
        token_type: 'bearer',
        access_token: '123access',
        expires_in: secondsInDay,
      };
    }
    res.status(HTTP_STATUS_OK).json(obj);
  });
};
