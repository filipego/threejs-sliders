import ThreeSlider from "./components/ThreeSlider";
import ThreeSliderDraggable from "./components/ThreeSliderDraggable";

export default function Home() {
  return (
    <main className="p-8 space-y-12">
      {/* ... Header ... */}

      <section>
        <h2 className="text-2xl mb-4">Default Slider</h2>
        <ThreeSliderDraggable /> {/* Uses default props */}
      </section>

      <section>
        <h2 className="text-2xl mb-4">Portrait Slides (Cover Fit)</h2>
        <ThreeSliderDraggable
          slideWidth={1.2} // Narrower
          slideHeight={2.0} // Taller
          gap={0.05} // Smaller gap
          imageFitMode="cover" // Make images cover the slide area
          imagesAvailable={3} // Assuming only images 1.jpg, 2.jpg, 3.jpg are relevant here
          slideCount={8} // Fewer planes in the loop
        />
      </section>

      <section>
        <h2 className="text-2xl mb-4">Wider Slides (Contain Fit)</h2>
        <ThreeSliderDraggable
          slideWidth={4.0}
          slideHeight={1.2}
          gap={0.2}
          imageFitMode="contain" // Default, but explicit
        />
      </section>

      {/* <section>
        <h2 className="text-2xl mb-4">Portrait Slides (Cover Fit)</h2>
        <ThreeSlider
          slideWidth={1.2} // Narrower
          slideHeight={2.0} // Taller
          gap={0.05} // Smaller gap
          imageFitMode="cover" // Make images cover the slide area
          imagesAvailable={3} // Assuming only images 1.jpg, 2.jpg, 3.jpg are relevant here
          slideCount={8} // Fewer planes in the loop
        />
      </section> */}

      {/* ... Footer ... */}
    </main>
  );
}
