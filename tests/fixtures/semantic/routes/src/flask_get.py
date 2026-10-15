from flask import Flask
app = Flask(__name__)
@app.get('/flask/get')
def flask_get_handler():
    return 'ok'
