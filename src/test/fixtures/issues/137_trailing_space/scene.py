from manim import *


class VideoScene(Scene):
    def construct(self):
        self.play(Create(Circle()), run_time=0.5)
