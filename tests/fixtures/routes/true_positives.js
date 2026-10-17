server.route({ method: 'GET', path: '/hapi/items', handler: listItems });
const routes = [{ path: '/vue/account', component: Account }];
const tree = [{ path: '/react/home', element: <Home /> }];
