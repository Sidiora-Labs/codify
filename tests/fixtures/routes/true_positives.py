from fastapi import FastAPI, APIRouter

app = FastAPI()
router = APIRouter()
users_router = APIRouter()

app.get('/items', list_items)
router.post("/orders", create_order)
users_router.delete('/users/{id}', remove_user)
api.put('/', replace_root)

@app.get('/health')
def health(): pass

@router.patch("/orders/{id}")
def patch_order(): pass
