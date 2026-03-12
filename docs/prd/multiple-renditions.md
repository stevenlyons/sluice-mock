# Feature PRD: Multiple Renditions

## Overview

ABR video supports multiple renditions as a foundational feature to optimize the quality of the video shown to viewers. Rendition changes and the associated player handling are needed to meaningfully test the behavior of a player and support real-world scenarios. 

## Goals

- Developers able to specify number of renditions available and serving behavior of segments
- Ability to test ABR behavior and observability tool correctness
- Simple and developer-friendly configuration of behavior 

## Scearios

Scenarios developers would like to test (with this and additional tools):
- Validate the which rendition is chosen by the player to start the stream
- How the player ABR behavior behaves when thoughput can support higher or lower renditions
- Player behavior when a rendition can't be downloaded or returns an error
- Events are fired correctly as renditions change

## Specifications

- Segment filenames in the manifests should denote the bandwidth of the rendition. For example, the 400000 rendition should have a filename like: seg-high-1.m4s. The actual files coming from the disk will be seg-X.m4s but they would be re-written as served to the player.