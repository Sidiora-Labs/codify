function listItems(req, res) { return res.json([]); }
app.get('/express/items', listItems);
app.post(
  '/express/multiline',
  listItems
);
app.put(
  // registration may be spread across a long comment run
  // line 2
  // line 3
  // line 4
  // line 5
  // line 6
  // line 7
  // line 8
  // line 9
  // line 10
  // line 11
  // line 12
  '/express/long',
  listItems
);
app.get('/express/unknown', missingHandler);
app.get('/express/duplicate', listItems);
app.get('/express/duplicate', missingHandler);
const computed = '/computed';
app.get(computed, listItems);
app.get(`/dynamic/${id}`, listItems);
router.get('/child', listItems);
app.use('/mounted', router);
// app.get('/ghost', listItems);
/*
app.get('/block-ghost', listItems);
*/
const prose = `
app.get('/template-ghost', listItems)
`;
const label = "app.get('/string', listItems)";
