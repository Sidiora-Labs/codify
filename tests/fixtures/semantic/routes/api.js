function listItems(req, res) { return res.json([]); }
app.get('/express/items', listItems);
app.post(
  '/express/multiline',
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
