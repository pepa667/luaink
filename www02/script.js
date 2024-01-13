let controller = new ScrollMagic.Controller();
let timeline = new TimelineMax();

timeline
  .to(".heroTXT", 5, { opacity:1, bottom: "25%"})
  .to(".heroTXT", 10, { bottom: "30%" })
  .to(".heroTXT", 5, { opacity:0, y: -300 })
  .to(".fineLine", 5, { opacity:1, bottom: "25%" }, "-=7")
  .to(".fineLine", 10, { bottom: "30%" })
  .to(".fineLine", 5, { opacity:0, y: -300 })
  .to(".blackWork", 5, { opacity:1, bottom: "25%" }, "-=7")
  .to(".blackWork", 10, { bottom: "30%" })
  .to(".blackWork", 5, { opacity:0, y: -300 })
  .to(".heroBG", 60, { top: "-20vh" }, "-=60")

  ;

let scene = new ScrollMagic.Scene({
  triggerElement: "main",
  duration: "500%",
  triggerHook: 0,
})
  .setTween(timeline)
  .setPin("main")
  .addTo(controller);
