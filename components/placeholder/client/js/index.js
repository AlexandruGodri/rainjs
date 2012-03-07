define(function() {
    /**
     * Creates a Placeholder instance.
     *
     * @name Placeholder
     * @class Placeholder controller class.
     * @constructor
     */
    function Placeholder() {
        this.on('init', init);
        this.on('start', start);
    }

    function init(){
        console.log("initi");
    }


    /**
     * Startup lifecycle step that happens right after the markup is in place.
     */
    function start() {
        console.log('Placeholder was started.');
    };

    return Placeholder;
});
