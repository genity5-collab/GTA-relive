# GTA:relive

A 3D map of San Andreas that runs in your browser. Map first, no gameplay yet.

Play it: https://genity5-collab.github.io/GTA-relive/

## What is in it
- Real San Andreas terrain from the SanMap aerial image and heightmap
- A road network (streets, main roads, freeways) traced from the SanMap road map
- Buildings placed along those roads, set back from the curb, with taller towers in the Los Santos, San Fierro and Las Venturas centres
- Real CC0 PBR textures on roads, sidewalks and building walls (Poly Haven), and real low-poly models for houses, shops, apartment blocks, vehicles and street furniture (CC0 city kit)
- Trees by terrain type (pines, broadleaf, palms, cacti) and flocks of birds
- Real landmarks, airports, safehouses and schools as labels
- Day, sunset and night

## Controls
There is no on-screen UI. Click the game to capture the mouse.

- **W A S D** move, **Shift** sprint, **Space** jump, **mouse** look, **wheel** camera distance
- **T** time of day (day, sunset, night), **Q** graphics quality (Lite, Medium, High)
- Touch: drag on the left half to move (push far to sprint), drag on the right half to look, tap the right half to jump

## Movement
Acceleration and friction, gravity, slopes that slow you down (and cliffs you cannot climb), solid buildings you slide along, roofs you can land on, and swimming in the sea.

It starts in Lite and lowers its own quality if the frame rate drops. It needs WebGL.

## Assets and size
The whole site is about 6 MB, far under any size limit. Buildings near you use the real models and swap to cheap boxes in the distance, so the GPU load stays low. See LICENSES.md for every source.

## Credits
Map imagery by Ian Albert (CC-BY-SA), packaged in [SanMap](https://github.com/jamiemansfield/SanMap) by Jamie Mansfield (MIT). Trees, buildings and birds are generated here and contain no Rockstar assets. Fan project, not affiliated with Rockstar Games.
