"""Small, source-backed route registrations for each required adapter.

The handler and route labels are separate: finding a path string alone does
not prove that a route was connected to the right handler.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Framework:
    name: str
    files: dict[str, str]
    method: str
    path: str
    handler: str
    decoy_path: str
    extra_decoy_paths: tuple[str, ...] = ()


FRAMEWORKS = [
    Framework("express", {"src/app.ts": "import express from 'express';\nconst app = express();\nfunction v16_express_handler(req: any, res: any) { res.send('ok'); }\n// app.get('/v16-decoy-express', v16_express_handler);\n/*\napp.get('/v16-decoy-express-block', v16_express_handler);\n*/\nconst example = \"app.get('/v16-decoy-express-string', v16_express_handler)\";\napp.get(\n  '/v16-express',\n  v16_express_handler\n);\n"}, "GET", "/v16-express", "v16_express_handler", "/v16-decoy-express", ("/v16-decoy-express-block", "/v16-decoy-express-string")),
    Framework("nextjs", {"app/v16-nextjs/route.ts": "// export async function v16_decoy_nextjs() {}\nexport async function GET() { return new Response('ok'); }\n"}, "GET", "/v16-nextjs", "GET", "/v16-decoy-nextjs"),
    Framework("react_router", {"src/routes.tsx": "import { createBrowserRouter } from 'react-router-dom';\nfunction V16ReactHandler() { return <p>ok</p>; }\n// { path: '/v16-decoy-react', element: <V16ReactHandler /> }\nexport const router = createBrowserRouter([{ path: '/v16-react', element: <V16ReactHandler /> }]);\n"}, "GET", "/v16-react", "V16ReactHandler", "/v16-decoy-react"),
    Framework("expo_router", {"app/v16-expo.tsx": "// export default function v16_decoy_expo() { return null; }\nexport default function v16_expo_handler() { return null; }\n"}, "GET", "/v16-expo", "v16_expo_handler", "/v16-decoy-expo"),
    Framework("sveltekit", {"src/routes/v16-svelte/+page.server.ts": "// export function v16_decoy_svelte_route() {}\nexport function load() { return { ok: true }; }\n"}, "GET", "/v16-svelte", "load", "/v16-decoy-svelte"),
    Framework("vue_nuxt", {"server/api/v16-vue.get.ts": "// export default function v16_decoy_vue() {}\nexport default function v16_vue_handler() { return { ok: true }; }\n"}, "GET", "/api/v16-vue", "v16_vue_handler", "/v16-decoy-vue"),
    Framework("fastapi", {"src/app.py": "from fastapi import FastAPI\napp = FastAPI()\n# @app.get('/v16-decoy-fastapi')\n\"\"\"\n@app.get('/v16-decoy-fastapi-block')\n\"\"\"\nexample = \"@app.get('/v16-decoy-fastapi-string')\"\n@app.get(\n    '/v16-fastapi'\n)\ndef v16_fastapi_handler():\n    return {'ok': True}\n"}, "GET", "/v16-fastapi", "v16_fastapi_handler", "/v16-decoy-fastapi", ("/v16-decoy-fastapi-block", "/v16-decoy-fastapi-string")),
    Framework("django", {"src/urls.py": "from django.urls import path\ndef v16_django_handler(request):\n    return None\n# path('v16-decoy-django/', v16_django_handler)\nurlpatterns = [path('v16-django/', v16_django_handler)]\n"}, "GET", "/v16-django/", "v16_django_handler", "/v16-decoy-django/"),
    Framework("flask", {"src/app.py": "from flask import Flask\napp = Flask(__name__)\n# @app.get('/v16-decoy-flask')\n@app.get('/v16-flask')\ndef v16_flask_handler():\n    return 'ok'\n"}, "GET", "/v16-flask", "v16_flask_handler", "/v16-decoy-flask"),
    Framework("laravel", {"routes/web.php": "<?php\nuse Illuminate\\Support\\Facades\\Route;\nfunction v16_laravel_handler() { return 'ok'; }\n// Route::get('/v16-decoy-laravel', 'v16_laravel_handler');\nRoute::get('/v16-laravel', 'v16_laravel_handler');\n"}, "GET", "/v16-laravel", "v16_laravel_handler", "/v16-decoy-laravel"),
    Framework("rails", {"config/routes.rb": "Rails.application.routes.draw do\n  # get '/v16-decoy-rails', to: 'v16_rails#show'\n  get '/v16-rails', to: 'v16_rails#show'\nend\n", "app/controllers/v16_rails_controller.rb": "class V16RailsController\n  def show\n    'ok'\n  end\nend\n"}, "GET", "/v16-rails", "show", "/v16-decoy-rails"),
    Framework("spring", {"src/App.java": "import org.springframework.web.bind.annotation.GetMapping;\nclass App {\n  // @GetMapping(\"/v16-decoy-spring\")\n  /* @GetMapping(\"/v16-decoy-spring-block\") */\n  String example = \"@GetMapping(/v16-decoy-spring-string)\";\n  @GetMapping(\n    \"/v16-spring\"\n  )\n  public String v16_spring_handler() { return \"ok\"; }\n}\n"}, "GET", "/v16-spring", "v16_spring_handler", "/v16-decoy-spring", ("/v16-decoy-spring-block", "/v16-decoy-spring-string")),
    Framework("gin", {"src/main.go": "package main\nimport \"github.com/gin-gonic/gin\"\nfunc v16_gin_handler(c *gin.Context) { c.String(200, \"ok\") }\nfunc main() {\n r := gin.New()\n // r.GET(\"/v16-decoy-gin\", v16_gin_handler)\n /* r.GET(\"/v16-decoy-gin-block\", v16_gin_handler) */\n _ = \"r.GET(/v16-decoy-gin-string, v16_gin_handler)\"\n r.GET(\n   \"/v16-gin\",\n   v16_gin_handler,\n )\n}\n"}, "GET", "/v16-gin", "v16_gin_handler", "/v16-decoy-gin", ("/v16-decoy-gin-block", "/v16-decoy-gin-string")),
    Framework("axum", {"src/main.rs": "use axum::{routing::get, Router};\nasync fn v16_axum_handler() -> &'static str { \"ok\" }\nfn app() -> Router {\n // Router::new().route(\"/v16-decoy-axum\", get(v16_axum_handler))\n Router::new().route(\"/v16-axum\", get(v16_axum_handler))\n}\n"}, "GET", "/v16-axum", "v16_axum_handler", "/v16-decoy-axum"),
    Framework("aspnet", {"src/Program.cs": "var app = WebApplication.Create();\nstring v16_aspnet_handler() => \"ok\";\n// app.MapGet(\"/v16-decoy-aspnet\", v16_aspnet_handler);\napp.MapGet(\"/v16-aspnet\", v16_aspnet_handler);\n"}, "GET", "/v16-aspnet", "v16_aspnet_handler", "/v16-decoy-aspnet"),
    Framework("vapor", {"src/routes.swift": "import Vapor\nfunc v16_vapor_handler(_ req: Request) -> String { return \"ok\" }\nfunc routes(_ app: Application) throws {\n // app.get(\"v16-decoy-vapor\", use: v16_vapor_handler)\n app.get(\"v16-vapor\", use: v16_vapor_handler)\n}\n"}, "GET", "/v16-vapor", "v16_vapor_handler", "/v16-decoy-vapor"),
]


REQUIRED_FRAMEWORKS = frozenset({
    "express", "nextjs", "react_router", "expo_router", "sveltekit", "vue_nuxt",
    "fastapi", "django", "flask", "laravel", "rails", "spring", "gin", "axum",
    "aspnet", "vapor",
})
assert {f.name for f in FRAMEWORKS} == REQUIRED_FRAMEWORKS
assert len(REQUIRED_FRAMEWORKS) == len(FRAMEWORKS)
