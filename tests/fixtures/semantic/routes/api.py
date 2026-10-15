def list_items():
    return []

app.get('/fastapi/items', list_items)
@app.post(
  '/fastapi/multiline'
)
def multiline():
    return []
app.get('/fastapi/missing', missing_handler)
"""
@app.get('/python-ghost')
"""
