  # Editor de Cena WebGL2 

Editor de cena 3D que carrega modelos .obj de uma pasta local, permite arrastar
a câmera, instanciar modelos clicando nas miniaturas, editar transformações,
animar e salvar/carregar a cena em JSON.

  # Estrutura esperada
```
editor/
├── index.html
├── script.js
├── camera.js
├── scene.js
├── obj-loader.js
├── webgl-utils.js
├── lista.js
└── Assets/
    └── obj/
        ├── barrel.obj
        ├── barrel.mtl          (opcional)
        ├── barrel.png          (opcional, referenciada pelo mtl)
        ├── ...
```

  # Como rodar
Coloque o seu pacote de modelos dentro de `Assets/obj/`. Os nomes em
`lista.js` (`modelNames`) precisam bater com os arquivos `.obj` (sem extensão).
Se algum arquivo não existir, ele é apenas pulado com aviso no console.

Os módulos ES e o `fetch` exigem servidor HTTP. Escolha um:

```bash
# Python 3
python3 -m http.server 8000

# Node (npx)
npx serve .

# PHP
php -S localhost:8000
```
Abra `http://localhost:8000` e clique em Carregar Modelos (à direita).

# Uso

  Miniaturas (direita): clique para adicionar à cena.
  
  Canvas: clique-esquerdo arrasta para orbitar; Shift+arrastar (ou botão
  direito) faz pan; scroll dá zoom; clicar num objeto seleciona via picking.
  
  Painel esquerdo: edita posição, rotação (graus), escala, alvo de
  animação e velocidade. Botões Play/Stop animam o objeto selecionado.
  
  Salvar cena: baixa `scene.json`.
  
  Carregar cena: restaura objetos (precisa ter os mesmos modelos
  carregados na biblioteca primeiro).
