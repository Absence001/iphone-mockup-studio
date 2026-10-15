# Сторонние материалы

## 3D-модели

Файлы предоставлены пользователем и используются локально. Сведения ниже прочитаны из `asset.extras` соответствующих GLB.

| Файл | Автор | Лицензия в метаданных | Источник |
| --- | --- | --- | --- |
| iphone.glb | polyman | CC BY 4.0 | https://sketchfab.com/3d-models/apple-iphone-15-pro-max-black-df17520841214c1792fb8a44c6783ee7 |
| iphone18.glb | extraakash | Sketchfab Standard | https://sketchfab.com/3d-models/apple-iphone-18-pro-max-black-2026-8fd804a9b0ea49249de3f1e0450fbc9c |
| iphone18-glacier.glb | extraakash | Sketchfab Standard | https://sketchfab.com/3d-models/apple-iphone-18-pro-max-glacier-2026-86dc4a625ae2444c97cf8469a6f6f016 |
| iphone18-burgundy.glb | extraakash | Sketchfab Standard | https://sketchfab.com/3d-models/apple-iphone-18-pro-max-burgundy-2026-604acc18b5d5455d820a16359b45b003 |
| iphone18-silver.glb | extraakash | Sketchfab Standard | https://sketchfab.com/3d-models/apple-iphone-18-pro-max-silver-2026-d383a366cc9e464ba4b24e5ddb996866 |
| iphone-duo-star-white.glb | extraakash | Sketchfab Standard | https://sketchfab.com/3d-models/apple-iphone-duo-fold-star-white-2026-animated-240492141edd4594ae13082a7fcbbb29 |
| galaxy-s26-ultra.glb | gadirovsaid7 | CC BY 4.0 | https://sketchfab.com/3d-models/samsung-galaxy-s26-ultra-15023522b9e342a194454fb371163f8e |
| macbook-pro-14.glb | Apple User | Sketchfab Standard | https://sketchfab.com/3d-models/macbook-pro-14-inch-m5-652a992f4f244122ae251f9cbb81da1e |
| pro-display-xdr.glb | polyman Studio | CC BY 4.0 | https://sketchfab.com/3d-models/apple-pro-display-xdr-7e92cfb7c84d41f886c7748be6c567da |

GLB сохранены без изменения. При отображении приложение нормализует масштаб и ориентацию и подставляет изображение на геометрию экрана. Вырез камеры можно отключить; освободившееся место заполняется продолжением изображения. Исходные файлы пользователя в Downloads не изменялись.

Особенности новых моделей:

- iPhone Duo: положение шарнира задаётся анимацией `open-close` из файла.
- Galaxy S26 Ultra: материалы в формате `KHR_materials_pbrSpecularGlossiness`, который three.js больше не читает. При загрузке они переводятся в metallic-roughness; файл не меняется.
- Pro Display XDR: в файле экран развёрнут обратной стороной и включает чёрную рамку, поэтому изображение отражается обратно и выводится в активную область.
- Названия цветов Galaxy (Violet), MacBook (Space Black) и Pro Display XDR (Silver) не указаны в метаданных и подобраны по виду модели.

CC BY 4.0: https://creativecommons.org/licenses/by/4.0/

Sketchfab Standard: https://sketchfab.com/licenses

## Fluid Functionalism

Автор: Micka Touillaud / mickadesign.

Лицензия MIT; полный текст — `licenses/fluid-functionalism.txt`.

Сайт: https://www.fluidfunctionalism.com/

Исходный код: https://github.com/mickadesign/fluid-functionalism

Компоненты и их общие зависимости получены через официальный registry с помощью shadcn CLI. В проекте используются Button, Select, TabsSubtle и сопровождающие утилиты. Тема адаптирована под нейтральную палитру редактора.

## Inter

Inter Variable, Rasmus Andersson. SIL Open Font License 1.1.

Полный текст — `licenses/Inter-OFL.txt`.

Источник шрифта: https://rsms.me/inter/font-files/InterVariable.woff2

Проект и лицензия: https://github.com/rsms/inter
