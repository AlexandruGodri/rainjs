define(function () {
    /**
     * Get a new instance for ClientRenderer.
     *
     * @class Handles the asynchronous rendering of components.
     * @name ClientRenderer
     * @constructor
     */
    function ClientRenderer() {
    }

    /**
     * Loads a component from the server.
     *
     * @param {Object} options
     */
    ClientRenderer.prototype.loadComponent = function (options) {
        $.ajax({
            url: '/components/client_renderer/controller/serverside.js',
            dataType: 'jsonp',
            data: options
        });
    };

    /**
     * Renders a component received via JSONP.
     *
     * @param {Object} component the component to be rendered
     */
    ClientRenderer.prototype.renderComponent = function (component) {
        console.log(component);
    };
    
    /**
     * Inserts the component in the page
     * 
     * @param {ClientRenderer} self the class instance
     * @param {Object} component the component to be rendered
     */
    function insertComponent(self, component) {
        
    }

    window.clientRenderer = new ClientRenderer();

    return window.clientRenderer;
});